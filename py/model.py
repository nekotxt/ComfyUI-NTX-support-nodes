from comfy_api.latest import ComfyExtension, io

import os
import shutil
import subprocess
import sys
from pathlib import Path

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, SETTINGS_DIR
from .logging import logger
from .utils import load_list_models, load_list_samplers, load_list_schedulers, find_model_file
from ..scripts.ntxdata_file import NtxDataFile

MODELTYPE_SEPARATOR = ":"

def build_full_models_list():
    full_list = [f"ckpt{MODELTYPE_SEPARATOR}{name}" for name in load_list_models("checkpoints")] + [f"diff{MODELTYPE_SEPARATOR}{name}" for name in load_list_models("diffusion_models")]
    return full_list

def split_model_type_and_name(full_name:str):
    if not MODELTYPE_SEPARATOR in full_name:
        return ("undefined", full_name)
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
        (kwargs["model_type"], kwargs["model_name"]) = split_model_type_and_name(kwargs.get("model_name", "")) #kwargs.get("model_name", "").split(MODELTYPE_SEPARATOR, 1) # strip the model type prefix
        return io.NodeOutput(*kwargs.values())

class ModelInfoSimple(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ModelInfoSimple",
            display_name=f"{ADDON_PREFIX} Model Info Simple",
            category=f"{ADDON_CATEGORY}/info",
            inputs=[
                io.Combo.Input("model_name", options=build_full_models_list()),
                io.Combo.Input("clip_name", options=["None"] + load_list_models("text_encoders")),
                io.Combo.Input("clip_name_2", options=["None"] + load_list_models("text_encoders")),
                io.Combo.Input("clip_name_3", options=["None"] + load_list_models("text_encoders")),
                io.Combo.Input("vae_name", options=["Baked VAE"] + load_list_models("vae"), default="Baked VAE"),
            ],
            outputs=[
                io.AnyType.Output("model_name"),
                io.AnyType.Output("clip_name"),
                io.AnyType.Output("clip_name_2"),
                io.AnyType.Output("clip_name_3"),
                io.AnyType.Output("vae_name"),
                io.String.Output("model_type"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        (kwargs["model_type"], kwargs["model_name"]) = split_model_type_and_name(kwargs.get("model_name", "")) #kwargs.get("model_name", "").split(MODELTYPE_SEPARATOR, 1) # strip the model type prefix
        return io.NodeOutput(*kwargs.values())

class KSamplerConfig(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}KSamplerConfig",
            display_name=f"{ADDON_PREFIX} KSampler Config",
            category=f"{ADDON_CATEGORY}/info",
            inputs=[
                io.Int.Input("steps", default=20, min=1, max=100, step=1),
                io.Float.Input("cfg", default=1.0, min=0.0, max=20.0, step=0.1, round=0.1),
                io.Combo.Input("sampler_name", options=load_list_samplers()),
                io.Combo.Input("scheduler", options=load_list_schedulers()),
            ],
            outputs=[
                io.Int.Output("steps"),
                io.Float.Output("cfg"),
                io.AnyType.Output("sampler_name"),
                io.AnyType.Output("scheduler"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        return io.NodeOutput(*kwargs.values())


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        ModelInfo,
        ModelInfoSimple,
        KSamplerConfig,
    ]


# ===== JAVASCRIPT API =====================================================================================================================

from aiohttp import web
from server import PromptServer

@PromptServer.instance.routes.post(f"/{API_PREFIX}/get_modelinfo_data")
async def get_modelinfo_data(request):
    # Accepts a model_name value from the ModelInfo node and returns the known
    # data for as many of its widgets as could be resolved. Widgets missing
    # from the response are left untouched by the frontend.

    data = await request.json()

    model_name = data.get("model_name", "")

    if model_name == "":
        return web.json_response({})

    (model_type, model_id) = split_model_type_and_name(model_name)

    # try to recover the data associated with the model (a file with same path as the model, but with .ntxdata extension)
    source_data = None
    (model_id, model_path) = find_model_file(model_type, model_id)
    if model_path != None:
        data_file_path = Path(model_path).with_suffix(".ntxdata")
        if data_file_path.is_file():
            ntx_data = NtxDataFile()
            ntx_data.load(data_file_path)
            source_data = ntx_data.data.get("model", None)
            if source_data is not None:
                source_data["notes"] = source_data.get("notes", "") + ntx_data.data.get("notes", "")
    if source_data == None:
        logger.warning(f"Model file not found or incomplete for {model_name}")
        return web.json_response(None)

    # validate the values

    def _check_clip(name:str):
        name_clean = name.strip().lower()
        if name_clean == "" or name_clean in ["none", "embedded"]:
            return "None"
        else:
            (model_name_found, model_path) = find_model_file("clip", name)
            return model_name_found

    def _check_vae(name:str):
        name_clean = name.strip().lower()
        if name_clean == "" or name_clean in ["baked vae", "embedded"]:
            return "Baked VAE"
        else:
            (model_name_found, model_path) = find_model_file("vae", name)
            return model_name_found

    response = {}
    response["model_name"] =            model_name
    response["clip_name"] =             _check_clip(source_data.get("clip", ""))
    response["clip_name_2"] =           _check_clip(source_data.get("clip2", ""))
    response["clip_name_3"] =           _check_clip(source_data.get("clip3", ""))
    response["vae_name"] =              _check_vae(source_data.get("vae", ""))
    response["clip_skip"] =             val if (val:=source_data.get("clip_skip", 0)) <= 0 else -val
    response["shift"] =                 val if (val:=source_data.get("shift", 0.0)) >= 0.0 else -val
    response["guidance"] =              val if (val:=source_data.get("guidance", 0.0)) >= 0.0 else -val
    response["steps"] =                 source_data.get("steps", None)
    response["cfg"] =                   source_data.get("cfg", None)
    response["sampler_name"] =          name if (name:=source_data.get("sampler_name", "").strip().lower()) in load_list_samplers() else None
    response["scheduler"] =             name if (name:=source_data.get("scheduler", "").strip().lower()) in load_list_schedulers() else None
    response["model_prompt_positive"] = source_data.get("positive", "")
    response["model_prompt_negative"] = source_data.get("negative", "")
    response["notes"] =                 source_data.get("notes", "")

    return web.json_response(response)

@PromptServer.instance.routes.post(f"/{API_PREFIX}/save_modelinfo_data")
async def save_modelinfo_data(request):
    # Accepts the current widget values from the ModelInfo node.
    data = await request.json()

    model_name = data.get("model_name", "")

    if model_name == "":
        return web.json_response({"message": "model_name is missing: cannot save"})

    (model_type, model_id) = split_model_type_and_name(model_name)

    # try to recover the data associated with the model (a file with same path as the model, but with .ntxdata extension)
    (model_id, model_path) = find_model_file(model_type, model_id)
    if model_path == None:
        return web.json_response({"message": "Cannot resolve the location of the model file: cannot save"})
    data_file_path = Path(model_path).with_suffix(".ntxdata")
    ntx_data = NtxDataFile(data_file_path)
    if data_file_path.is_file():
        ntx_data.load()
    if not "model" in ntx_data.data:
        ntx_data.data["model"] = {}
    
    # write the new data
    name_map = {
        "clip_name": "clip",
        "clip_name_2": "clip2",
        "clip_name_3": "clip3",
        "vae_name": "vae",
        "model_prompt_positive": "positive",
        "model_prompt_negative": "negative",
    }
    for k,v in data.items():
        if k in ["model_name", "notes"]:
            continue
        ntx_data.data["model"][name_map.get(k, k)] = v
    ntx_data.id = model_id
    ntx_data.model_type = model_type
    if "notes" in data:
        ntx_data.data["notes"] = data["notes"]

    # save the new file
    new_data_file_path = Path(model_path).with_suffix(".ntxdata_new")
    ntx_data.save(new_data_file_path)

    return web.json_response({"message": f"Saved to {new_data_file_path}"})

# ----- "Edit model info" (web/js/model.edit_model_info.js) -------------------------------------------------------------------------------

# Model branches shown in the frontend tree, in display order.
EDIT_MODEL_INFO_TYPES = ["checkpoints", "diffusion_models", "loras", "vae", "text_encoders"]

# Templates offered when a model has no side-car .txt yet (flat *.txt files).
MODELDATA_TEMPLATES_DIR = SETTINGS_DIR / "modeldata"

def _open_in_default_editor(path: Path):
    # Open a file with the OS default application for its type.
    if sys.platform.startswith("win"):
        os.startfile(str(path))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])

@PromptServer.instance.routes.get(f"/{API_PREFIX}/edit_model_info/models")
async def edit_model_info_models(request):
    # Returns the .safetensors models of every branch in EDIT_MODEL_INFO_TYPES:
    # { "checkpoints": ["subdir/model.safetensors", ...], ... }
    # Paths are relative to the branch and use "/" separators.
    branches = {}
    for model_type in EDIT_MODEL_INFO_TYPES:
        names = load_list_models(model_type)
        branches[model_type] = sorted(
            (name.replace("\\", "/") for name in names if name.lower().endswith(".safetensors")),
            key=str.lower,
        )
    return web.json_response(branches)

@PromptServer.instance.routes.post(f"/{API_PREFIX}/edit_model_info/open")
async def edit_model_info_open(request):
    # Opens the side-car .txt of a model in the OS default editor.
    # Payload: { model_type, model_name, template? }
    # - .txt exists                    -> open it, respond {status:"opened"}
    # - .txt missing, no template yet  -> respond {status:"missing", templates:[...]}
    #   (the frontend then asks the user to pick one and calls again)
    # - .txt missing, template given   -> copy the template next to the model, open it
    data = await request.json()
    model_type = data.get("model_type", "")
    model_name = data.get("model_name", "")
    template = data.get("template", None)

    if model_type not in EDIT_MODEL_INFO_TYPES or not model_name:
        return web.json_response({"status": "error", "message": "Invalid model_type or model_name"}, status=400)

    (model_name, model_path) = find_model_file(model_type, model_name)
    if model_path is None:
        return web.json_response({"status": "error", "message": f"Model file not found: {model_name}"}, status=404)

    txt_path = Path(model_path).with_suffix(".txt")

    if not txt_path.is_file():
        if template is None:
            templates = []
            if MODELDATA_TEMPLATES_DIR.is_dir():
                templates = sorted((p.name for p in MODELDATA_TEMPLATES_DIR.glob("*.txt")), key=str.lower)
            return web.json_response({"status": "missing", "templates": templates})
        # bare file name only: no path components allowed
        if Path(template).name != template:
            return web.json_response({"status": "error", "message": f"Invalid template name: {template}"}, status=400)
        template_path = MODELDATA_TEMPLATES_DIR / template
        if not template_path.is_file():
            return web.json_response({"status": "error", "message": f"Template not found: {template}"}, status=404)
        try:
            shutil.copyfile(template_path, txt_path)
        except Exception as e:
            return web.json_response({"status": "error", "message": f"Could not create {txt_path}: {e}"}, status=500)
        logger.info(f"Created model info file {txt_path} from template {template}")

    try:
        _open_in_default_editor(txt_path)
    except Exception as e:
        return web.json_response({"status": "error", "message": f"Could not open editor: {e}"}, status=500)

    return web.json_response({"status": "opened", "path": str(txt_path)})
