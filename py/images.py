from comfy_api.latest import ComfyExtension, io, ui

import comfy.utils
import folder_paths

import json
import math
import numpy as np
import torch
import typing
from datetime import datetime
from pathlib import Path
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from torchvision.transforms import InterpolationMode
from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger
from .utils import  load_list_image_sizes, extract_image_size, image_crop, image_rescale_keeping_aspect_ratio, load_list_image_aspect_ratios, extract_image_aspect_ratio

# ===== Custom types ===========================================================================================================================

LIST_SAVED_IMAGES = io.Custom("LIST_SAVED_IMAGES")

# ===== Image utilities ========================================================================================================================

# decode image from tensor
def tensor_to_pillow(image: typing.Any) -> Image.Image:
    return Image.fromarray(np.clip(255. * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

# encode image into tensor
def pillow_to_tensor(image: Image.Image) -> typing.Any:
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

# round a dimension so that it is a multiple of divisor (nearest multiple, never below divisor)
def round_to_multiple(value: int, divisor: int) -> int:
    if divisor <= 1:
        return value
    return max(divisor, int(round(value / divisor)) * divisor)

# crop a [B, C, H, W] tensor to the aspect ratio of (width, height), keeping the excess
# according to crop_position (center, top, bottom, left, right). Returns a view (no copy).
def crop_to_aspect(samples, width: int, height: int, crop_position: str):
    old_width = samples.shape[-1]
    old_height = samples.shape[-2]
    old_aspect = old_width / old_height
    new_aspect = width / height

    if old_aspect > new_aspect:  # source is wider than the target -> crop left/right excess
        crop_w = max(1, round(old_height * new_aspect))
        excess = old_width - crop_w
        if crop_position == "left":
            x = 0
        elif crop_position == "right":
            x = excess
        else:  # center, top, bottom
            x = excess // 2
        samples = samples.narrow(-1, x, crop_w)
    elif old_aspect < new_aspect:  # source is taller than the target -> crop top/bottom excess
        crop_h = max(1, round(old_width / new_aspect))
        excess = old_height - crop_h
        if crop_position == "top":
            y = 0
        elif crop_position == "bottom":
            y = excess
        else:  # center, left, right
            y = excess // 2
        samples = samples.narrow(-2, y, crop_h)

    return samples

# rescale an IMAGE tensor [B, H, W, C] to (width, height), cropping the excess by crop_position
def resize_image_cover(image, width: int, height: int, upscale_method: str, crop_position: str):
    samples = image.movedim(-1, 1)  # [B, H, W, C] -> [B, C, H, W]
    samples = crop_to_aspect(samples, width, height, crop_position)
    samples = comfy.utils.common_upscale(samples, width, height, upscale_method, "disabled")
    return samples.movedim(1, -1)  # [B, C, H, W] -> [B, H, W, C]

# rescale a MASK tensor [B, H, W] to (width, height), cropping the excess by crop_position
def resize_mask_cover(mask, width: int, height: int, upscale_method: str, crop_position: str):
    samples = mask.unsqueeze(1)  # [B, H, W] -> [B, 1, H, W]
    samples = crop_to_aspect(samples, width, height, crop_position)
    samples = comfy.utils.common_upscale(samples, width, height, upscale_method, "disabled")
    # common_upscale drops the channel dim for single-channel lanczos, keeps it otherwise
    if samples.ndim == 4:
        samples = samples.squeeze(1)
    return samples  # [B, H, W]

# parse a "#rrggbb" (or "#rgb") hex color string into (r, g, b) floats in [0, 1]
def parse_hex_color(color: str) -> tuple[float, float, float]:
    color = color.lstrip("#")
    try:
        if len(color) == 3:
            return tuple(int(c * 2, 16) / 255.0 for c in color)
        return (int(color[0:2], 16) / 255.0, int(color[2:4], 16) / 255.0, int(color[4:6], 16) / 255.0)
    except (ValueError, IndexError):
        return (0.0, 0.0, 0.0)

# rescale an IMAGE tensor [B, H, W, C] to exactly (width, height), no cropping or padding
def resize_image_plain(image, width: int, height: int, upscale_method: str):
    samples = image.movedim(-1, 1)  # [B, H, W, C] -> [B, C, H, W]
    samples = comfy.utils.common_upscale(samples, width, height, upscale_method, "disabled")
    return samples.movedim(1, -1)  # [B, C, H, W] -> [B, H, W, C]

# rescale a MASK tensor [B, H, W] to exactly (width, height), no cropping or padding
def resize_mask_plain(mask, width: int, height: int, upscale_method: str):
    samples = mask.unsqueeze(1)  # [B, H, W] -> [B, 1, H, W]
    samples = comfy.utils.common_upscale(samples, width, height, upscale_method, "disabled")
    if samples.ndim == 4:  # single-channel lanczos drops the channel dim
        samples = samples.squeeze(1)
    return samples  # [B, H, W]

# position the scaled content (new_width, new_height) on the (width, height) canvas
# according to pad_position (center, top, bottom, left, right); returns (x, y) offsets.
# The axis not addressed by pad_position is always centered (evenly split padding).
def pad_offsets(width: int, height: int, new_width: int, new_height: int, pad_position: str) -> tuple[int, int]:
    excess_x = width - new_width
    excess_y = height - new_height

    if pad_position == "left":
        x = 0
    elif pad_position == "right":
        x = excess_x
    else:  # center, top, bottom
        x = excess_x // 2

    if pad_position == "top":
        y = 0
    elif pad_position == "bottom":
        y = excess_y
    else:  # center, left, right
        y = excess_y // 2

    return (x, y)

# rescale an IMAGE tensor [B, H, W, C] to fit inside (width, height) keeping aspect ratio,
# then place it on a (width, height) canvas filled with pad_color (hex string)
def resize_image_pad(image, width: int, height: int, upscale_method: str, pad_color: str, pad_position: str="center"):
    samples = image.movedim(-1, 1)  # [B, H, W, C] -> [B, C, H, W]

    old_width = samples.shape[-1]
    old_height = samples.shape[-2]
    ratio = min(width / old_width, height / old_height)
    new_width = max(1, round(old_width * ratio))
    new_height = max(1, round(old_height * ratio))

    samples = comfy.utils.common_upscale(samples, new_width, new_height, upscale_method, "disabled")

    batch, channels = samples.shape[0], samples.shape[1]
    fill = list(parse_hex_color(pad_color)) + [1.0]  # extra channel (alpha) padded opaque
    fill_tensor = torch.tensor(fill[:channels], dtype=samples.dtype, device=samples.device).view(1, channels, 1, 1)
    canvas = fill_tensor.expand(batch, channels, height, width).clone()

    x, y = pad_offsets(width, height, new_width, new_height, pad_position)
    canvas[:, :, y:y + new_height, x:x + new_width] = samples

    return canvas.movedim(1, -1)  # [B, C, H, W] -> [B, H, W, C]

# rescale a MASK tensor [B, H, W] to fit inside (width, height) keeping aspect ratio,
# then place it on a (width, height) canvas filled with pad_value
def resize_mask_pad(mask, width: int, height: int, upscale_method: str, pad_value: float, pad_position: str="center"):
    samples = mask.unsqueeze(1)  # [B, H, W] -> [B, 1, H, W]

    old_width = samples.shape[-1]
    old_height = samples.shape[-2]
    ratio = min(width / old_width, height / old_height)
    new_width = max(1, round(old_width * ratio))
    new_height = max(1, round(old_height * ratio))

    samples = comfy.utils.common_upscale(samples, new_width, new_height, upscale_method, "disabled")
    if samples.ndim == 3:  # single-channel lanczos drops the channel dim
        samples = samples.unsqueeze(1)

    canvas = torch.full((samples.shape[0], 1, height, width), pad_value, dtype=samples.dtype, device=samples.device)

    x, y = pad_offsets(width, height, new_width, new_height, pad_position)
    canvas[:, :, y:y + new_height, x:x + new_width] = samples

    return canvas.squeeze(1)  # [B, 1, H, W] -> [B, H, W]

# utility function to calculate the optimal number of columns for an image grid
def calculate_number_of_columns(numOfImages):
    if(numOfImages <= 3):
        return numOfImages
    if(numOfImages == 4):
        return 2
    if(numOfImages <= 6):
        return 3
    if(numOfImages <= 8):
        return 4
    if(numOfImages == 9):
        return 3
    return 4

# utility for image grid creation
def create_images_grid(images: list[Image.Image], gap=2, background_color="black") -> Image.Image:

    # calculate the size of the grid
    max_columns = calculate_number_of_columns(len(images))
    max_rows = math.ceil(len(images) / max_columns)

    # create the background image grid
    size = images[0].size
    grid_width = size[0] * max_columns + (max_columns - 1) * gap
    grid_height = size[1] * max_rows + (max_rows - 1) * gap
    grid_image = Image.new("RGB", (grid_width, grid_height), color=background_color)

    # copy the images on the grid
    for i, image in enumerate(images):
        x = (i % max_columns) * (size[0] + gap)
        y = (i // max_columns) * (size[1] + gap)
        grid_image.paste(image, (x, y))

    return grid_image


# ===== NODES : IMAGES ==================================================================================================================

class SaveMultipleImages(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SaveMultipleImages",
            display_name=f"{ADDON_PREFIX} Save Multiple Images",
            category=f"{ADDON_CATEGORY}/images",
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.Boolean.Input("date_in_name", default=True, label_on="yes", label_off="no"),
                io.String.Input("save_prefix", multiline=False, dynamic_prompts=False, default=""),
                io.Boolean.Input("save_individual", default=False, label_on="yes", label_off="no"),
                io.Boolean.Input("save_grid", default=True, label_on="yes", label_off="no"),
                io.Int.Input("grid_gap", default=2, min=1, max=50, step=1),
                io.String.Input("grid_color", default="black"),
                io.Boolean.Input("save_workflow", default=True, label_on="yes", label_off="no"),
                io.AnyType.Input("model_name", optional=True),
                io.AnyType.Input("sampler_name", optional=True),
                io.AnyType.Input("scheduler", optional=True),
                io.Boolean.Input("preview", default=True, label_on="yes", label_off="no", optional=True),
            ],
            outputs=[
                io.Image.Output("grid"),
                LIST_SAVED_IMAGES.Output("list_saved_images"),
            ],
            hidden=[io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images, date_in_name: bool, save_prefix: str, save_individual: bool, save_grid: bool, grid_gap: int, grid_color: str, save_workflow: bool, model_name=None, sampler_name=None, scheduler=None, preview: bool=True):

        logger.node_name("SaveMultipleImages")

        # exit if there are no images
        if images is None:
            logger.info("no input images, exit")
            return io.NodeOutput(None, [])

        # calculate file save name
        file_name = save_prefix

        if date_in_name:
            now = datetime.now()
            file_name = f"{file_name}_{str(now.year)[-2:]}{now.month:02}{now.day:02}{now.hour:02}{now.minute:02}{now.second:02}"

        if model_name is not None:
            model_name = Path(model_name).stem
            file_name = f"{file_name}_{model_name}"

        if sampler_name is not None:
            file_name = f"{file_name}_{sampler_name}"

        if scheduler is not None:
            file_name = f"{file_name}_{scheduler}"

        # ensure the output directory exists
        output_dir = Path(folder_paths.get_output_directory())

        example_file = output_dir / f"{file_name}.png"

        directory = example_file.parent
        directory.mkdir(parents=True, exist_ok=True)

        extra_pnginfo = cls.hidden.extra_pnginfo
        metadata = PngInfo()
        if save_workflow:
            if extra_pnginfo is not None:
                for x in extra_pnginfo:
                    metadata.add_text(x, json.dumps(extra_pnginfo[x]))

        # build a single grid image
        img_list = []
        for (batch_number, image) in enumerate(images):
            img = tensor_to_pillow(image)
            img_list.append(img)

        img_grid = img_list[0] if len(img_list) == 1 else create_images_grid(img_list, grid_gap, grid_color)

        # create a list to keep track of the files generated
        list_saved_images = list()

        # if requested save the single grid image
        if save_grid:
            logger.info("Save grid image :")
            image_grid_path = output_dir / f"{file_name}.png"
            img_grid.save(image_grid_path, pnginfo=metadata, compress_level=4)
            list_saved_images.append(str(image_grid_path))

        # if requested save the image files (but skip if the grid was saved and there is only 1 image)
        if save_grid & (len(img_list) == 1):
            save_individual = False

        if save_individual:
            logger.info("Save single images :")
            counter = 1
            for img in img_list:
                image_file_path = output_dir / f"{file_name}_{counter:05}.png"
                img.save(image_file_path, pnginfo=metadata, compress_level=4)
                list_saved_images.append(str(image_file_path))
                counter += 1

        for s in list_saved_images:
            logger.info(f"Saved file : {s}")

        output_image_grid = pillow_to_tensor(img_grid)

        if preview:
            return io.NodeOutput(output_image_grid, list_saved_images, ui=ui.PreviewImage(output_image_grid, cls=cls))
        else:
            return io.NodeOutput(output_image_grid, list_saved_images)

class ImageSize(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ImageSize",
            display_name=f"{ADDON_PREFIX} Image Size",
            description="Pick image size from presets",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                io.Combo.Input("image_size", options=["custom"] + load_list_image_sizes(), default="custom"),
                io.Int.Input("width", default=0, min=0, max=4096, step=1),
                io.Int.Input("height", default=0, min=0, max=4096, step=1),
                io.Image.Input("opt_image", optional=True),
                io.Combo.Input("opt_image_size", options=["use image size", "crop to input size", "resize and use new size"], optional=True),
            ],
            outputs=[
                io.Int.Output("width"),
                io.Int.Output("height"),
                io.Image.Output("opt_image"),
            ],
        )

    @classmethod
    def execute(cls, image_size, width, height, opt_image=None, opt_image_size=None):

        if image_size != "custom": # decode standard image size if any
            width, height = extract_image_size(image_size)

        if opt_image is not None:
            if opt_image_size == "crop to input size":
                opt_image = image_crop(opt_image, width, height)
            elif opt_image_size == "resize and use new size":
                opt_image = image_rescale_keeping_aspect_ratio(opt_image, width, height)
                width = opt_image.shape[2]
                height = opt_image.shape[1]
            else: # "use image size"
                width = opt_image.shape[2]
                height = opt_image.shape[1]

        return io.NodeOutput(width, height, opt_image)

class ImageResolution(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ImageResolution",
            display_name=f"{ADDON_PREFIX} Image Resolution",
            description="Output a (width, height) resolution, either custom or picked from the image size presets, rounded with divisible_by",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                io.DynamicCombo.Input("mode", options=[
                    io.DynamicCombo.Option("custom", [
                        io.Int.Input("width", default=512, min=1, max=16384, step=1),
                        io.Int.Input("height", default=512, min=1, max=16384, step=1),
                    ]),
                    io.DynamicCombo.Option("preset", [
                        io.Combo.Input("image_size", options=load_list_image_sizes()),
                    ]),
                    io.DynamicCombo.Option("resolution", [
                        io.Combo.Input("aspect_ratio", options=load_list_image_aspect_ratios()),
                        io.Float.Input("megapixel", default=1.0, min=0.01, max=256.0, step=0.05),
                    ]),
                    io.DynamicCombo.Option("resolution and width", [
                        io.Int.Input("width", default=1024, min=1, max=16384, step=1),
                        io.Float.Input("megapixel", default=1.0, min=0.01, max=256.0, step=0.05),
                    ]),
                    io.DynamicCombo.Option("resolution and height", [
                        io.Int.Input("height", default=1024, min=1, max=16384, step=1),
                        io.Float.Input("megapixel", default=1.0, min=0.01, max=256.0, step=0.05),
                    ]),
                    io.DynamicCombo.Option("match image", [
                        io.MultiType.Input("match", types=[io.Image, io.Mask]),
                    ]),
                ]),
                io.Int.Input("divisible_by", default=8, min=1, max=1024, step=1),
            ],
            outputs=[
                io.Int.Output("width"),
                io.Int.Output("height"),
            ],
        )

    @classmethod
    def execute(cls, mode: io.DynamicCombo.Type, divisible_by) -> io.NodeOutput:
        if mode["mode"] == "custom":
            width, height = mode["width"], mode["height"]
        elif mode["mode"] == "resolution":
            # size with the requested pixel count (1 megapixel = 1024x1024) and aspect ratio
            ratio_w, ratio_h = extract_image_aspect_ratio(mode["aspect_ratio"])
            pixels = mode["megapixel"] * 1024 * 1024
            width = max(1, round(math.sqrt(pixels * ratio_w / ratio_h)))
            height = max(1, round(width * ratio_h / ratio_w))
        elif mode["mode"] == "resolution and width":
            # height giving the requested pixel count (1 megapixel = 1024x1024) at the given width
            width = mode["width"]
            height = max(1, round(mode["megapixel"] * 1024 * 1024 / width))
        elif mode["mode"] == "resolution and height":
            # width giving the requested pixel count (1 megapixel = 1024x1024) at the given height
            height = mode["height"]
            width = max(1, round(mode["megapixel"] * 1024 * 1024 / height))
        elif mode["mode"] == "match image":
            # both IMAGE [B, H, W, C] and MASK [B, H, W] have width and height at the same indices
            match = mode["match"]
            width, height = match.shape[2], match.shape[1]
        else:  # "preset"
            width, height = extract_image_size(mode["image_size"])

        return io.NodeOutput(round_to_multiple(width, divisible_by), round_to_multiple(height, divisible_by))

class ExtractImageFromBatch(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ExtractImageFromBatch",
            display_name=f"{ADDON_PREFIX} Extract Image From Batch",
            description="Extract the image at [index] from a batch of images; returns None if images is null or index is out of range",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                io.Image.Input("images", optional=True),
                io.Int.Input("index", default=0, min=0),
            ],
            outputs=[
                io.Image.Output("image"),
            ],
        )

    @classmethod
    def execute(cls, images=None, index=0) -> io.NodeOutput:
        if images is None:
            #logger.warning("ExtractImageFromBatch : images is null")
            return io.NodeOutput(None)

        if index >= images.shape[0]:
            #logger.warning(f"ExtractImageFromBatch : index {index} exceeds batch size {images.shape[0]}")
            return io.NodeOutput(None)

        return io.NodeOutput(images[index:index + 1])

class ResizeImageMask(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ResizeImageMask",
            display_name=f"{ADDON_PREFIX} Resize Image Mask",
            description="Resize an image and/or mask with a selectable strategy: pass-through, crop or pad to a size (or to match another input), or scale by multiplier, side, or total pixels; the final size is rounded with divisible_by",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                io.Image.Input("image", optional=True),
                io.Mask.Input("mask", optional=True),
                io.DynamicCombo.Input("mode", options=[
                    io.DynamicCombo.Option("do nothing", []),
                    io.DynamicCombo.Option("round", []),
                    io.DynamicCombo.Option("crop to size", [
                        io.Int.Input("width", default=512, min=1, max=16384, step=1),
                        io.Int.Input("height", default=512, min=1, max=16384, step=1),
                        io.Combo.Input("crop", options=["center", "top", "bottom", "left", "right"], default="center"),
                    ]),
                    io.DynamicCombo.Option("pad to size", [
                        io.Int.Input("width", default=512, min=1, max=16384, step=1),
                        io.Int.Input("height", default=512, min=1, max=16384, step=1),
                        io.Combo.Input("pad", options=["center", "top", "bottom", "left", "right"], default="center"),
                        io.Color.Input("pad_color", default="#000000"),
                    ]),
                    io.DynamicCombo.Option("scale by multiplier", [
                        io.Float.Input("multiplier", default=1.0, min=0.01, max=16.0, step=0.05),
                    ]),
                    io.DynamicCombo.Option("scale longer dimension", [
                        io.Int.Input("longer_side", default=1024, min=1, max=16384, step=1),
                    ]),
                    io.DynamicCombo.Option("scale shorter dimension", [
                        io.Int.Input("shorter_side", default=1024, min=1, max=16384, step=1),
                    ]),
                    io.DynamicCombo.Option("scale width", [
                        io.Int.Input("width", default=1024, min=1, max=16384, step=1),
                    ]),
                    io.DynamicCombo.Option("scale height", [
                        io.Int.Input("height", default=1024, min=1, max=16384, step=1),
                    ]),
                    io.DynamicCombo.Option("scale total pixels", [
                        io.Float.Input("megapixels", default=1.0, min=0.01, max=256.0, step=0.05),
                    ]),
                    io.DynamicCombo.Option("crop to match input", [
                        io.MultiType.Input("match", types=[io.Image, io.Mask]),
                        io.Combo.Input("crop", options=["center", "top", "bottom", "left", "right"], default="center"),
                    ]),
                    io.DynamicCombo.Option("pad to match input", [
                        io.MultiType.Input("match", types=[io.Image, io.Mask]),
                        io.Combo.Input("pad", options=["center", "top", "bottom", "left", "right"], default="center"),
                        io.Color.Input("pad_color", default="#000000"),
                    ]),
                ]),
                io.Combo.Input("upscale_method", options=["nearest-exact", "bilinear", "area", "bicubic", "lanczos"], default="nearest-exact"),
                io.Int.Input("divisible_by", default=1, min=1, max=1024, step=1),
            ],
            outputs=[
                io.Image.Output("image"),
                io.Mask.Output("mask"),
                io.Int.Output("width"),
                io.Int.Output("height"),
            ],
        )

    # final size of the image (or of the mask if the image is null); both are [B, H, W, ...]
    @classmethod
    def get_final_size(cls, image, mask) -> tuple[int, int]:
        reference = image if image is not None else mask
        if reference is None:
            return (0, 0)
        return (reference.shape[2], reference.shape[1])

    @classmethod
    def execute(cls, mode: io.DynamicCombo.Type, upscale_method, divisible_by, image=None, mask=None) -> io.NodeOutput:

        logger.node_name("ResizeImageMask")

        # if both inputs are provided, they must share the exact same size (batch, height, width)
        if image is not None and mask is not None:
            image_size = (image.shape[0], image.shape[1], image.shape[2])   # [B, H, W, C]
            mask_size = (mask.shape[0], mask.shape[1], mask.shape[2])        # [B, H, W]
            if image_size != mask_size:
                raise ValueError(
                    f"ResizeImageMask: image and mask must have the same size, "
                    f"got image (batch={image_size[0]}, {image_size[2]}x{image_size[1]}) "
                    f"and mask (batch={mask_size[0]}, {mask_size[2]}x{mask_size[1]})"
                )

        # "do nothing" : pass the inputs through unchanged (divisible_by is ignored)
        if mode["mode"] == "do nothing":
            final_width, final_height = cls.get_final_size(image, mask)
            return io.NodeOutput(image, mask, final_width, final_height)

        out_image = None
        out_mask = None

        if mode["mode"] == "scale by multiplier":
            # scale the input size by the multiplier, then round with divisible_by
            source_width, source_height = cls.get_final_size(image, mask)
            multiplier = mode["multiplier"]
            target_width = round_to_multiple(max(1, round(source_width * multiplier)), divisible_by)
            target_height = round_to_multiple(max(1, round(source_height * multiplier)), divisible_by)
            if image is not None:
                out_image = resize_image_plain(image, target_width, target_height, upscale_method)
            if mask is not None:
                out_mask = resize_mask_plain(mask, target_width, target_height, upscale_method)

        elif mode["mode"] == "round":
            # round with divisible_by
            source_width, source_height = cls.get_final_size(image, mask)
            target_width = round_to_multiple(source_width, divisible_by)
            target_height = round_to_multiple(source_height, divisible_by)
            if image is not None:
                out_image = resize_image_plain(image, target_width, target_height, upscale_method)
            if mask is not None:
                out_mask = resize_mask_plain(mask, target_width, target_height, upscale_method)

        elif mode["mode"] in ("scale longer dimension", "scale shorter dimension", "scale width", "scale height"):
            # scale the chosen side to the given value (rounded with divisible_by),
            # the other side follows the aspect ratio (also rounded with divisible_by)
            source_width, source_height = cls.get_final_size(image, mask)
            if mode["mode"] == "scale longer dimension":
                target_side = round_to_multiple(mode["longer_side"], divisible_by)
                source_side = max(source_width, source_height)
            elif mode["mode"] == "scale shorter dimension":
                target_side = round_to_multiple(mode["shorter_side"], divisible_by)
                source_side = min(source_width, source_height)
            elif mode["mode"] == "scale width":
                target_side = round_to_multiple(mode["width"], divisible_by)
                source_side = source_width
            else:  # "scale height"
                target_side = round_to_multiple(mode["height"], divisible_by)
                source_side = source_height
            if source_side > 0:
                scale = target_side / source_side
                target_width = round_to_multiple(max(1, round(source_width * scale)), divisible_by)
                target_height = round_to_multiple(max(1, round(source_height * scale)), divisible_by)
                if image is not None:
                    out_image = resize_image_plain(image, target_width, target_height, upscale_method)
                if mask is not None:
                    out_mask = resize_mask_plain(mask, target_width, target_height, upscale_method)

        elif mode["mode"] == "scale total pixels":
            # scale both sides by the same factor so that the total pixel count matches
            # the requested megapixels (1 megapixel = 1024x1024), then round with divisible_by
            source_width, source_height = cls.get_final_size(image, mask)
            if source_width > 0 and source_height > 0:
                scale = math.sqrt(mode["megapixels"] * 1024 * 1024 / (source_width * source_height))
                target_width = round_to_multiple(max(1, round(source_width * scale)), divisible_by)
                target_height = round_to_multiple(max(1, round(source_height * scale)), divisible_by)
                if image is not None:
                    out_image = resize_image_plain(image, target_width, target_height, upscale_method)
                if mask is not None:
                    out_mask = resize_mask_plain(mask, target_width, target_height, upscale_method)

        else:
            # "crop/pad to size" : the target dimensions come from the width/height widgets
            # "crop/pad to match input" : the target dimensions come from the "match" input (IMAGE or MASK, both are [B, H, W, ...])
            if mode["mode"] in ("crop to match input", "pad to match input"):
                match = mode["match"]
                target_width = round_to_multiple(match.shape[2], divisible_by)
                target_height = round_to_multiple(match.shape[1], divisible_by)
            else:
                target_width = round_to_multiple(mode["width"], divisible_by)
                target_height = round_to_multiple(mode["height"], divisible_by)

            if mode["mode"] in ("crop to size", "crop to match input"):
                # rescale to the target size, cropping the excess at the position given by "crop"
                crop = mode["crop"]
                if image is not None:
                    out_image = resize_image_cover(image, target_width, target_height, upscale_method, crop)
                if mask is not None:
                    out_mask = resize_mask_cover(mask, target_width, target_height, upscale_method, crop)

            else:  # "pad to size" / "pad to match input"
                # rescale to fit the target size, padding the empty parts with pad_color (the mask is always padded with 0)
                # at the position given by "pad" (the axis not addressed by "pad" gets evenly split padding)
                pad = mode["pad"]
                pad_color = mode["pad_color"]
                if image is not None:
                    out_image = resize_image_pad(image, target_width, target_height, upscale_method, pad_color, pad)
                if mask is not None:
                    out_mask = resize_mask_pad(mask, target_width, target_height, upscale_method, 0.0, pad)

        final_width, final_height = cls.get_final_size(out_image, out_mask)
        return io.NodeOutput(out_image, out_mask, final_width, final_height)

class MaskOverlay(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}MaskOverlay",
            display_name=f"{ADDON_PREFIX} Mask Overlay",
            description="Preview a mask overlaid on an image as a colored layer; with only one input connected, preview that input as-is",
            category=f"{ADDON_CATEGORY}/images",
            is_output_node=True,
            inputs=[
                io.Float.Input("mask_opacity", default=0.5, min=0.0, max=1.0, step=0.01, tooltip="Opacity of the mask overlay (0.0-1.0)"),
                io.Color.Input("mask_color", default="#0000FF", tooltip="Color of the mask overlay"),
                io.Image.Input("image", optional=True, tooltip="Input image (RGBA will be converted to RGB)"),
                io.Mask.Input("mask", optional=True, tooltip="Input mask"),
            ],
            outputs=[
                io.Image.Output("image"),
                io.Mask.Output("mask"),
            ],
        )

    @classmethod
    def execute(cls, mask_opacity, mask_color, image=None, mask=None) -> io.NodeOutput:

        logger.node_name("MaskOverlay")

        if image is not None and image.shape[-1] == 4:  # RGBA -> RGB
            image = image[..., :3]

        if mask is not None:
            mask = mask.reshape((-1, mask.shape[-2], mask.shape[-1]))  # normalize to [B, H, W]

        if image is None and mask is None:
            preview = torch.zeros((1, 64, 64, 3))
        elif image is None:
            preview = mask.unsqueeze(-1).expand(-1, -1, -1, 3)  # grayscale preview of the mask alone
        elif mask is None:
            preview = image
        else:
            # blend a solid mask_color layer over the image, weighted by mask * mask_opacity
            blend_mask = mask
            if blend_mask.shape[-2:] != image.shape[1:3]:
                blend_mask = resize_mask_plain(blend_mask, image.shape[2], image.shape[1], "bilinear")
            weight = (blend_mask * mask_opacity).clamp(0.0, 1.0).unsqueeze(-1)  # [B, H, W, 1]
            color = torch.tensor(parse_hex_color(mask_color), dtype=image.dtype, device=image.device)
            preview = image * (1.0 - weight) + color * weight

        if mask is None:
            mask = torch.zeros((1, 64, 64))

        return io.NodeOutput(preview, mask, ui=ui.PreviewImage(preview, cls=cls))

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        SaveMultipleImages,
        ImageSize,
        ImageResolution,
        ExtractImageFromBatch,
        ResizeImageMask,
        MaskOverlay,
    ]
