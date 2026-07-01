from comfy_api.latest import ComfyExtension, io

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX
from .utils import load_list_models, load_list_samplers, load_list_schedulers, find_model_file

MODELTYPE_SEPARATOR = "  "

def build_full_models_list():
    full_list = [f"ckpt{MODELTYPE_SEPARATOR}{name}" for name in load_list_models("checkpoints")] + [f"diff{MODELTYPE_SEPARATOR}{name}" for name in load_list_models("diffusion_models")]
    return full_list

def split_model_type_and_name(full_name:str):
    model_type, model_name = full_name.split(MODELTYPE_SEPARATOR, 1) # strip the model type prefix
    if model_type == "ckpt":
        model_type = "checkpoints"
    elif model_type == "diff":
        model_type = "diffusion_models"
    else:
        model_type = "undefined"
    return (model_type, model_name)

class ModelInfo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ModelInfo",
            display_name=f"{ADDON_PREFIX} Model Info",
            category=f"{ADDON_CATEGORY}/info",
            inputs=[
                io.Combo.Input("model_name", options=build_full_models_list()),
                io.Combo.Input("clip_name", options=["None"] + load_list_models("text_encoders")),
                io.Combo.Input("clip_name_2", options=["None"] + load_list_models("text_encoders")),
                io.Combo.Input("clip_name_3", options=["None"] + load_list_models("text_encoders")),
                io.Combo.Input("vae_name", options=["Baked VAE"] + load_list_models("vae"), default="Baked VAE"),
                io.Int.Input("clip_skip", default=-1, min=-100, max=0, step=1),
                io.Float.Input("shift", default=0.0, min=0.0, max=20.0, step=0.1, round=0.1),
                io.Float.Input("guidance", default=0.0, min=0.0, max=20.0, step=0.1, round=0.1),
                io.Int.Input("steps", default=20, min=1, max=100, step=1),
                io.Float.Input("cfg", default=1.0, min=0.0, max=20.0, step=0.1, round=0.1),
                io.Combo.Input("sampler_name", options=load_list_samplers()),
                io.Combo.Input("scheduler", options=load_list_schedulers()),
                io.String.Input("model_prompt_positive", multiline=False, dynamic_prompts=False, default=""),
                io.String.Input("model_prompt_negative", multiline=False, dynamic_prompts=False, default=""),
                io.String.Input("notes", multiline=True, dynamic_prompts=False, default=""),
            ],
            outputs=[
                io.AnyType.Output("model_name"),
                io.AnyType.Output("clip_name"),
                io.AnyType.Output("clip_name_2"),
                io.AnyType.Output("clip_name_3"),
                io.AnyType.Output("vae_name"),
                io.Int.Output("clip_skip"),
                io.Float.Output("shift"),
                io.Float.Output("guidance"),
                io.Int.Output("steps"),
                io.Float.Output("cfg"),
                io.AnyType.Output("sampler_name"),
                io.AnyType.Output("scheduler"),
                io.String.Output("model_prompt_positive"),
                io.String.Output("model_prompt_negative"),
                io.String.Output("notes"),
                io.String.Output("model_type"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        (kwargs["model_type"], kwargs["model_name"]) = kwargs.get("model_name", "").split(MODELTYPE_SEPARATOR, 1) # strip the model type prefix
        return io.NodeOutput(*kwargs.values())


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        ModelInfo,
    ]


# ===== JAVASCRIPT API =====================================================================================================================

from aiohttp import web
from server import PromptServer

@PromptServer.instance.routes.get(f"/{API_PREFIX}/get_modelinfo_data")
async def get_modelinfo_data(request):
    # Accepts a model_name value from ModelInfo node
    # and returns the default data for all fields of the ModelInfo node.

    data = await request.json()

    model_name = data.get("model_name", "")

    if model_name == "":
        return web.json_response({model_name: model_name})

    (model_type, model_id) = split_model_type_and_name(data.get("model_type", ""))

    source_data = {}

    # validate the clip and vae names
    clip_name   = "None" if (name:=source_data.get("clip", "")) == ""     else find_model_file("clip", name)[0]
    clip_name_2 = "None" if (name:=source_data.get("clip2", "")) == ""    else find_model_file("clip", name)[0]
    clip_name_3 = "None" if (name:=source_data.get("clip3", "")) == ""    else find_model_file("clip", name)[0]
    vae_name    = "Baked VAE" if (name:=source_data.get("vae", "")) == "" else find_model_file("vae", name)[0]

    response = {
        model_name: model_name,
        clip_name: clip_name,
        clip_name_2: clip_name_2,
        clip_name_3: clip_name_3,
        vae_name: vae_name,
        clip_skip: 0,
        shift: 0.0,
        guidance: 0.0,
        steps: 0,
        cfg: 1.0,
        sampler_name: "Euler",
        scheduler: "Simple",
        model_prompt_positive: "",
        model_prompt_negative: "",
        notes: "",
    }

    return web.json_response(response)

