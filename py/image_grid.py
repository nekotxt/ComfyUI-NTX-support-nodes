# CREATED WITH CLAUDE OPUS 4.8

import math

import torch

from comfy_api.latest import io

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger

# ===== HELPERS ============================================================================================================================

def _hex_to_rgb(hex_str: str) -> tuple[float, float, float]:
    """Convert a '#rrggbb' (or '#rgb') color string to RGB floats in 0..1."""
    s = (hex_str or "").lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        s = "000000"
    return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)


def _slot_index(key: str) -> int:
    """Sort autogrow slot keys numerically ('image_2' before 'image_10')."""
    try:
        return int(key.rsplit("_", 1)[-1])
    except ValueError:
        return 0

# ===== NODES ==============================================================================================================================

class ImageGridNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ImageGrid",
            display_name=f"{ADDON_PREFIX} Image Grid",
            description="Compose a variable number of images into a single uniform grid, "
                        "split over a given number of columns, with a configurable margin "
                        "and background color filling the gaps and padding.",
            category=f"{ADDON_CATEGORY}/image",
            inputs=[
                io.Autogrow.Input(
                    "images",
                    template=io.Autogrow.TemplatePrefix(
                        input=io.Image.Input("img"),
                        prefix="image_",
                        min=1,
                        max=64,
                    ),
                ),
                io.Int.Input("number_of_columns", default=2, min=1, max=12),
                io.Int.Input("margin", default=0, min=0, max=100),
                io.Color.Input("background_color", default="#000000"),
            ],
            outputs=[
                io.Image.Output("IMAGE"),
            ],
        )

    @classmethod
    def execute(cls, images, number_of_columns, margin, background_color):
        # Flatten every connected (possibly batched) input into individual [H, W, 3] frames.
        frames: list[torch.Tensor] = []
        for key in sorted(images.keys(), key=_slot_index):
            tensor = images[key]
            if tensor is None:
                continue
            if tensor.dim() == 3:
                tensor = tensor.unsqueeze(0)
            for i in range(tensor.shape[0]):
                frame = tensor[i]
                if frame.shape[-1] == 1:
                    frame = frame.repeat(1, 1, 3)
                else:
                    frame = frame[:, :, :3]
                frames.append(frame)

        device = frames[0].device if frames else torch.device("cpu")
        bg = torch.tensor(_hex_to_rgb(background_color), dtype=torch.float32, device=device)

        if not frames:
            logger.warning("ImageGrid: no images connected, returning a 1x1 background pixel.")
            return io.NodeOutput(bg.view(1, 1, 1, 3).clone())

        cols = max(1, int(number_of_columns))
        margin = max(0, int(margin))
        count = len(frames)
        rows = math.ceil(count / cols)

        # Uniform cell size = max width / height across all images.
        cell_h = max(f.shape[0] for f in frames)
        cell_w = max(f.shape[1] for f in frames)

        canvas_h = rows * cell_h + (rows - 1) * margin
        canvas_w = cols * cell_w + (cols - 1) * margin

        # Fill the whole canvas (including margins and per-image padding) with the background.
        canvas = bg.view(1, 1, 3).repeat(canvas_h, canvas_w, 1).clone()

        for idx, frame in enumerate(frames):
            row, col = divmod(idx, cols)
            cell_y = row * (cell_h + margin)
            cell_x = col * (cell_w + margin)
            fh, fw = frame.shape[0], frame.shape[1]
            # Center each image inside its uniform cell.
            off_y = cell_y + (cell_h - fh) // 2
            off_x = cell_x + (cell_w - fw) // 2
            canvas[off_y:off_y + fh, off_x:off_x + fw, :] = frame.to(canvas.dtype)

        logger.info(f"ImageGrid: composed {count} images into a {cols}x{rows} grid ({canvas_w}x{canvas_h}px).")
        return io.NodeOutput(canvas.unsqueeze(0))

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        ImageGridNode,
    ]
