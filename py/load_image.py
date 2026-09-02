from comfy_api.latest import io

import folder_paths
import nodes
import torch

import hashlib
import os

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger

# ===== Image loading utilities ================================================================================================================

# the list the image combo is filled with : every image file sitting in the ComfyUI input
# directory, exactly as the core Load Image node lists them
def load_list_input_images() -> list[str]:
    input_dir = folder_paths.get_input_directory()
    files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
    return sorted(folder_paths.filter_files_content_types(files, ["image"]))

# crop an image batch [B, H, W, C] and its mask [B, H, W] to the rectangle (x, y, width, height),
# expressed in pixels of the image. The rectangle is clamped to the image, and an empty one
# (zero width or height) means "no crop" : the image and the mask are returned untouched.
def crop_image_and_mask(image, mask, x: int, y: int, width: int, height: int):
    image_height = image.shape[1]
    image_width = image.shape[2]

    x = max(0, min(int(x), image_width))
    y = max(0, min(int(y), image_height))
    width = max(0, min(int(width), image_width - x))
    height = max(0, min(int(height), image_height - y))
    if width <= 0 or height <= 0:
        return image, mask

    cropped_image = image[:, y:y + height, x:x + width, :]

    # the mask only follows the crop when it actually covers the image : the loader hands back a
    # placeholder 64x64 mask for images without an alpha channel, and cropping that one would be
    # meaningless, so an empty mask of the cropped size is returned instead
    if mask.shape[1] == image_height and mask.shape[2] == image_width:
        cropped_mask = mask[:, y:y + height, x:x + width]
    else:
        cropped_mask = torch.zeros((mask.shape[0], height, width), dtype=mask.dtype, device=mask.device)

    return cropped_image, cropped_mask

# ===== NODES ==================================================================================================================================

class LoadImageAndCrop(io.ComfyNode):
    """Load Image with a crop rectangle drawn on the preview.

    The decoding itself is delegated to the core Load Image node, so this node behaves exactly like
    it : same file list, same upload button, same mask painting (the mask editor writes its result
    back into the "image" widget), same image / mask outputs.

    What it adds is a crop rectangle, edited by dragging on the image preview - see the frontend
    half in web/js/load_image.crop.js. The rectangle lives in the crop_x / crop_y / crop_width /
    crop_height widgets, in pixels of the loaded image; they are hidden on the node because the
    preview is what edits them, but they still serialize with the workflow and reach this node like
    any other widget. A zero width or height means "no crop".
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadImageAndCrop",
            display_name=f"{ADDON_PREFIX} Load Image & Crop",
            description="Load an image from the input directory, like the core Load Image node "
                        "(mask painting included), with an optional crop rectangle drawn on the preview.",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                io.Combo.Input(
                    "image",
                    options=load_list_input_images(),
                    upload=io.UploadType.image,
                    image_folder=io.FolderType.input,
                    tooltip="The image to load. Right click the node and pick 'Open in Mask Editor' to paint a mask.",
                ),
                # the crop rectangle : hidden and socketless, it is drawn and edited on the preview
                io.Int.Input("crop_x", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_y", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_width", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_height", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
            ],
            outputs=[
                io.Image.Output("image"),
                io.Mask.Output("mask"),
            ],
        )

    @classmethod
    def execute(cls, image, crop_x, crop_y, crop_width, crop_height) -> io.NodeOutput:
        logger.node_name("LoadImageAndCrop")

        # the core node does the decoding : animated formats, exif orientation, alpha -> mask,
        # and the clipspace files the mask editor produces
        loaded_image, loaded_mask = nodes.LoadImage().load_image(image)

        cropped_image, cropped_mask = crop_image_and_mask(loaded_image, loaded_mask,
                                                          crop_x, crop_y, crop_width, crop_height)

        if cropped_image is loaded_image:
            logger.info(f"loaded [{image}] ({loaded_image.shape[2]}x{loaded_image.shape[1]}), no crop")
        else:
            logger.info(f"loaded [{image}] ({loaded_image.shape[2]}x{loaded_image.shape[1]}), "
                        f"cropped to {cropped_image.shape[2]}x{cropped_image.shape[1]} at ({crop_x},{crop_y})")

        return io.NodeOutput(cropped_image, cropped_mask)

    @classmethod
    def fingerprint_inputs(cls, image, crop_x, crop_y, crop_width, crop_height):
        # the widget values are part of the cache key already ; what the executor cannot see is the
        # content of the file behind the name, which the mask editor rewrites in place
        image_path = folder_paths.get_annotated_filepath(image)
        digest = hashlib.sha256()
        with open(image_path, "rb") as file:
            digest.update(file.read())
        return digest.hexdigest()

    @classmethod
    def validate_inputs(cls, image):
        # naming "image" here also tells the executor to skip its own combo check on it, so freshly
        # uploaded files and the mask editor's clipspace/... paths are accepted
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True

# ===== INITIALIZATION =========================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        LoadImageAndCrop,
    ]
