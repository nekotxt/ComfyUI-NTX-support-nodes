import inspect

import torch
import torchvision.transforms.functional as TVF
from comfy_api.latest import io
from comfy_extras.nodes_textgen import TextGenerate
from comfy.text_encoders.gemma4 import Gemma4_Tokenizer, _get_aspect_ratio_preserving_size

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger

# ===== HELPERS ============================================================================================================================

# Gemma 4 vision constants, as used by Gemma4_Tokenizer.tokenize_with_weights for still images
GEMMA4_PATCH_SIZE = 16
GEMMA4_POOLING_K = 3
GEMMA4_MAX_SOFT_TOKENS = 280

def split_images(image_inputs) -> list[torch.Tensor]:
    """Flatten the connected IMAGE inputs, in slot order, into a list of single [1, H, W, 3] images."""
    images = []
    for name in sorted(image_inputs, key=lambda n: int(n.removeprefix("image") or 0)):
        batch = image_inputs[name]
        if batch is None:
            continue
        images.extend(batch[i:i + 1, :, :, :3] for i in range(batch.shape[0]))
    return images

def gemma4_pixels(image: torch.Tensor) -> torch.Tensor:
    """Resize one [1, H, W, C] image the way the Gemma 4 tokenizer does, but on its own aspect ratio."""
    s = (image[0].movedim(-1, 0).clamp(0, 1) * 255).to(torch.uint8)  # [C, H, W] uint8
    h, w = s.shape[1], s.shape[2]
    max_patches = GEMMA4_MAX_SOFT_TOKENS * GEMMA4_POOLING_K * GEMMA4_POOLING_K
    target_h, target_w = _get_aspect_ratio_preserving_size(h, w, GEMMA4_PATCH_SIZE, max_patches, GEMMA4_POOLING_K)
    if target_h != h or target_w != w:
        s = TVF.resize(s, [target_h, target_w], interpolation=TVF.InterpolationMode.BICUBIC, antialias=True)
    return (s.float() * (1.0 / 255.0)).unsqueeze(0).movedim(1, -1)

def tokenize_images(clip, text, images: list[torch.Tensor], **kwargs):
    """Tokenize text plus a list of images of any size, each one becoming its own image in the prompt."""
    if len(images) == 0:
        return clip.tokenize(text, **kwargs)

    wrapper = clip.tokenizer
    inner = getattr(wrapper, getattr(wrapper, "clip", ""), None)

    # Gemma 4 resizes a whole batch to one size: tokenize placeholders for N images, then swap in each image's own pixels
    if isinstance(inner, Gemma4_Tokenizer):
        placeholders = torch.zeros((len(images), 48, 48, 3))
        tokens = clip.tokenize(text, image=placeholders, **kwargs)
        pixels = iter([gemma4_pixels(img) for img in images])
        for rows in tokens.values():
            for row in rows:
                for i, token in enumerate(row):
                    if isinstance(token[0], dict) and token[0].get("type") == "image":
                        data = next(pixels, None)
                        if data is not None:
                            row[i] = ({**token[0], "data": data},) + token[1:]
        return tokens

    # Qwen3-VL / Qwen3.5 tokenizers take a list of separate images natively
    if "images" in inspect.signature(wrapper.tokenize_with_weights).parameters:
        return clip.tokenize(text, images=images, **kwargs)

    # Anything else only takes a batch, which needs a single size
    if len({tuple(img.shape[1:3]) for img in images}) == 1:
        return clip.tokenize(text, image=torch.cat(images, dim=0), **kwargs)
    raise ValueError(f"{type(inner or wrapper).__name__} does not support images of different sizes: resize them to a common size first.")

class ClipWithImages:
    """Proxy for a CLIP object whose tokenize() feeds a fixed list of images instead of the core image batch."""
    def __init__(self, clip, images):
        self._clip = clip
        self._images = images

    def __getattr__(self, name):
        return getattr(self._clip, name)

    def tokenize(self, text, image=None, **kwargs):
        return tokenize_images(self._clip, text, self._images, **kwargs)

# ===== NODES ==============================================================================================================================

class TextGenerateMultiImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        # Reuse the core node inputs so they follow ComfyUI updates, swapping image/video for a growing list of images
        core_inputs = {inp.id: inp for inp in TextGenerate.define_schema().inputs}
        images_template = io.Autogrow.TemplatePrefix(
            io.Image.Input("image", optional=True, tooltip="An image or a batch of images; every image is passed on its own, at its own size."),
            prefix="image", min=1, max=16,
        )
        inputs = [
            core_inputs["clip"],
            core_inputs["prompt"],
            io.Autogrow.Input("images", template=images_template),
        ]
        inputs += [inp for name, inp in core_inputs.items() if name not in ("clip", "prompt", "image", "video")]

        return io.Schema(
            node_id=f"{ADDON_PREFIX}TextGenerateMultiImage",
            display_name=f"{ADDON_PREFIX} Generate Text (Multi Image)",
            description="Generate Text with several images of different sizes, each passed to the model as a separate image, in slot order.",
            category=f"{ADDON_CATEGORY}/text",
            search_aliases=["LLM", "gemma", "qwen", "multi image", "interrogate"],
            inputs=inputs,
            outputs=[
                io.String.Output(display_name="generated_text"),
            ],
        )

    @classmethod
    def execute(cls, clip, prompt, images: io.Autogrow.Type = None, **kwargs) -> io.NodeOutput:
        image_list = split_images(images or {})
        logger.info(f"Generate Text (Multi Image): {len(image_list)} image(s) {[tuple(img.shape[1:3]) for img in image_list]}")
        return TextGenerate.execute(ClipWithImages(clip, image_list), prompt, **kwargs)

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        TextGenerateMultiImage,
    ]
