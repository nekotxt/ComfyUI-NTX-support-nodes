from comfy_api.latest import ComfyExtension, io, ui

import json

from pathlib import Path

from .config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, COMFY_DIR, SETTINGS_DIR
from .py.logging import logger#log_setup, log_info, log_warning
logger.info("Initialization ...")
from .py.utils import is_string_empty, clone_data, load_list_loras, load_list_vaes, load_list_samplers, load_list_schedulers

# ===== NODES INITIALIZATION =====================================================================================================================

from comfy_api.latest import ComfyExtension

class NTX_SE_Extension(ComfyExtension):
    # must be declared as async
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        list_of_nodes = []

        # scan the py subdir, and for each .py file try to call the get_nodes_list function
        import importlib
        import pkgutil
        from . import py as py_package
        for importer, module_name, is_pkg in pkgutil.iter_modules(py_package.__path__):
            module = importlib.import_module(f".py.{module_name}", package=__package__)
            if hasattr(module, "get_nodes_list"):
                module_nodes = module.get_nodes_list()
                list_of_nodes.extend(module_nodes)
                logger.info(f"Loaded {len(module_nodes)} nodes from module {module_name}")

        return list_of_nodes

# can be declared async or not, both will work
async def comfy_entrypoint() -> NTX_SE_Extension:
    return NTX_SE_Extension()

# ===== JAVASCRIPT API =====================================================================================================================

# Set the web directory, any .js file in that directory will be loaded by the frontend as a frontend extension
WEB_DIRECTORY = "./web"

# Add custom API routes, using router
from aiohttp import web
from server import PromptServer

# Support routes for node .py.loadinfo.LoadCheckpointInfo

@PromptServer.instance.routes.post(f"/{API_PREFIX}/get_checkpoint_info")
async def get_checkpoint_info(request):
    data = await request.json()
    ckpt_name = data.get("ckpt_name", "")
    if ckpt_name == "":
        return web.json_response(None)
        #return web.json_response({"notes": "ERROR : ckpt_name is empty!"})

    # print("get_checkpoint_info : ckpt_name")
    # print(ckpt_name)

    from .py.loadinfo import g_models_manager
    ckpt_info = g_models_manager.get_model(model_type="checkpoints", model_id=ckpt_name)
    if ckpt_info == None:
        return web.json_response(None)
        #return web.json_response({"notes": f"ERROR : ckpt_info is Null for {ckpt_name}!"})

    # print("get_checkpoint_info : initial data")
    # print(ckpt_info)
    
    # copy the notes info to the model data
    ckpt_info = clone_data(ckpt_info) # copy to prevent change of original data
    ckpt_info.setdefault("model", {}) # ensure the model section exists
    ckpt_info["model"]["notes"] = ckpt_info.get("notes", "") # copy notes to model section

    # ensure the vae / sampler / scheduler are a valid selection
    if not ckpt_info["model"].get("vae", "") in load_list_vaes():
        ckpt_info["model"]["vae"] = "Baked VAE"
    if not ckpt_info["model"].get("sampler_name", "") in load_list_samplers():
        ckpt_info["model"]["sampler_name"] = "euler"
    if not ckpt_info["model"].get("scheduler", "") in load_list_schedulers():
        ckpt_info["model"]["scheduler"] = "simple"
    
    # ensure clip_skip is negative
    clip_skip = int(ckpt_info["model"].get("clip_skip", 0))
    if clip_skip > 0:
        ckpt_info["model"]["clip_skip"] = - clip_skip

    # print("get_checkpoint_info : final data")
    # print(ckpt_info.get("model"))

    return web.json_response(ckpt_info.get("model"))

# Support routes for node .py.loadinfo.LoadCharInfo

@PromptServer.instance.routes.post(f"/{API_PREFIX}/get_options_for_char")
async def get_options_for_char(request):
    data = await request.json()
    char_name = data.get("char_name", "")
    
    from .py.loadinfo import g_characters_manager
    options_for_char = g_characters_manager.get_options_for_char(char_name=char_name)

    return web.json_response({"options_for_char": options_for_char})

@PromptServer.instance.routes.post(f"/{API_PREFIX}/get_prompt_for_char_option")
async def get_prompt_for_char_option(request):
    data = await request.json()
    char_name = data.get("char_name", "")
    option_name = data.get("option_name", "")
    
    from .py.loadinfo import g_characters_manager
    prompt_data = g_characters_manager.get_prompt_for_char_option(char_name=char_name, option_name=option_name)

    return web.json_response(prompt_data)

# Support routes for lora loader

@PromptServer.instance.routes.get(f"/{API_PREFIX}/get_loras_list")
async def _get_lora_list(request):
    return web.json_response(load_list_loras())
