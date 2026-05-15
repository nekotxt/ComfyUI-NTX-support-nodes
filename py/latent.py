from comfy_api.latest import ComfyExtension, io

import comfy.utils

from pathlib import Path
from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger
from .utils import load_list_vaes, load_list_image_sizes, extract_image_size

# ===== NODES ==============================================================================================================================

class LoadCustomVae(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadCustomVae",
            display_name=f"{ADDON_PREFIX} Load Custom Vae",
            description="If the flag is set to True, load the specified vae",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Boolean.Input("use_custom_vae", default=True, label_on="yes", label_off="no",
                                 tooltip="if yes, load and pass the specified VAE, instead of the input value"),
                io.Combo.Input("vae_name", options=load_list_vaes()),
                io.Vae.Input("vae", optional=True),
            ],
            outputs=[
                io.Vae.Output("vae"),
                io.String.Output("vae_name"),
            ],
        )

    @classmethod
    def execute(cls, use_custom_vae, vae_name, vae=None):

        if use_custom_vae:
            from nodes import VAELoader # the nodes module can be referenced, because its path is added to sys.path in __init__
            (vae, ) = VAELoader().load_vae(vae_name)
        else:
            vae_name = ""

        return io.NodeOutput(vae, vae_name)

class CreateImageLatent(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}CreateImageLatent",
            display_name=f"{ADDON_PREFIX} Create Image Latent",
            description="""Build the latents from the specified image size. If an image is provided, its size will be used.
                    To customize the list of image sizes, create a file /input/ntx_data/image_sizes.txt
                    and write the sizes, one for each row, int the form WIDTHxHEIGHT""",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Combo.Input("image_size", options=["custom"] + load_list_image_sizes(), default="custom"),
                io.Int.Input("width", default=0, min=0, max=4096, step=1),
                io.Int.Input("height", default=0, min=0, max=4096, step=1),
                io.Int.Input("batch_size", default=1, min=1, max=24),
                io.Image.Input("opt_image", optional=True),
                io.Vae.Input("vae", optional=True),
                io.Combo.Input("opt_image_size", options=["use image size", "crop to input size", "resize and use new size"], optional=True),
                io.Boolean.Input("opt_image_encode", default=True, label_on="yes", label_off="no", optional=True),
            ],
            outputs=[
                io.Int.Output("width"),
                io.Int.Output("height"),
                io.Int.Output("batch_size"),
                io.Latent.Output("latent"),
                io.Image.Output("opt_image"),
            ],
        )

    @classmethod
    def execute(cls, image_size, width, height, batch_size, opt_image=None, vae=None, opt_image_size=None, opt_image_encode=True):

        if image_size != "custom": # decode standard image size if any
            width, height = extract_image_size(image_size)

        if opt_image is not None:
            if opt_image_size == "crop to input size":
                opt_image = comfy.utils.common_upscale(opt_image.movedim(-1, 1), width, height, "lanczos", "center").movedim(1, -1)
            elif opt_image_size == "resize and use new size":
                image_w = opt_image.shape[2]
                image_h = opt_image.shape[1]

                ratio_w = width / image_w
                ratio_h = height / image_h
                if ratio_w < ratio_h:
                    final_width = width
                    final_height = round(image_h * ratio_w)
                else:
                    final_width = round(image_w * ratio_h)
                    final_height = height

                opt_image = comfy.utils.common_upscale(opt_image.movedim(-1, 1), final_width, final_height, "lanczos", "disabled").movedim(1, -1)
                width = opt_image.shape[2]
                height = opt_image.shape[1]
            else:
                width = opt_image.shape[2]
                height = opt_image.shape[1]

        if (opt_image is None) or (opt_image_encode == False):
            # latent_width = width // 8
            # latent_height = height // 8
            # samples = torch.zeros([batch_size, 4, latent_height, latent_width], device=comfy.model_management.intermediate_device())
            # width = latent_width * 8
            # height = latent_height * 8
            # latent = {"samples":samples, "downscale_ratio_spacial":8}
            from nodes import EmptyLatentImage # the nodes module can be referenced, because its path is added to sys.path in __init__
            (latent, ) = EmptyLatentImage().generate(width=width, height=height, batch_size=batch_size)
        else:
            from nodes import VAEEncode # the nodes module can be referenced, because its path is added to sys.path in __init__
            (latent, ) = VAEEncode().encode(vae, opt_image, )
            if batch_size > 1:
                from nodes import RepeatLatentBatch # the nodes module can be referenced, because its path is added to sys.path in __init__
                (latent, ) = RepeatLatentBatch().repeat(latent, batch_size, )

        return io.NodeOutput(width, height, batch_size, latent, opt_image)

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        LoadCustomVae,
        CreateImageLatent,
    ]
