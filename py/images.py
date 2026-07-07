from comfy_api.latest import ComfyExtension, io, ui

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
from .utils import  load_list_image_sizes, extract_image_size, image_crop, image_rescale_keeping_aspect_ratio

# ===== Custom types ===========================================================================================================================

LIST_SAVED_IMAGES = io.Custom("LIST_SAVED_IMAGES")

# ===== Image utilities ========================================================================================================================

# decode image from tensor
def tensor_to_pillow(image: typing.Any) -> Image.Image:
    return Image.fromarray(np.clip(255. * image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

# encode image into tensor
def pillow_to_tensor(image: Image.Image) -> typing.Any:
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

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

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        SaveMultipleImages,
        ImageSize,
        ExtractImageFromBatch,
    ]
