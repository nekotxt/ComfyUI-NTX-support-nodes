from comfy_api.latest import ComfyExtension, io, ui

import json

from pathlib import Path

from .config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, COMFY_DIR, SETTINGS_DIR, CONFIGURATION
from .py.logging import log_setup, log_info, log_warning
from .py.utils import is_string_empty, clone_data, load_list_loras, load_list_vaes, load_list_samplers, load_list_schedulers

# ===== INITIALIZATION =====================================================================================================================

# logging
log_setup(show_info=True, show_info_node_name=True, show_info_load_model=True, show_info_apply_model=True, show_warning=True)

# ===== NODES INITIALIZATION =====================================================================================================================

from comfy_api.latest import ComfyExtension

class NTX_SE_Extension(ComfyExtension):
    # must be declared as async
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        list_of_nodes = []
        
        from .py.context import get_nodes_list as context_get_nodes_list
        list_of_nodes.extend(context_get_nodes_list())
        
        from .py.images import get_nodes_list as images_get_nodes_list
        list_of_nodes.extend(images_get_nodes_list())
        
        from .py.loadinfo import get_nodes_list as loadinfo_get_nodes_list
        list_of_nodes.extend(loadinfo_get_nodes_list())
        
        from .py.pipe import get_nodes_list as pipe_get_nodes_list
        list_of_nodes.extend(pipe_get_nodes_list())
        
        from .py.reroutes import get_nodes_list as reroutes_get_nodes_list
        list_of_nodes.extend(reroutes_get_nodes_list())
        
        from .py.test import get_nodes_list as test_get_nodes_list
        list_of_nodes.extend(test_get_nodes_list())
        
        from .py.utils import get_nodes_list as utils_get_nodes_list
        list_of_nodes.extend(utils_get_nodes_list())
        
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

# Support routes for node LoadCheckpointInfo

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

# Support routes for node LoadCharInfo

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

# Support routes for downloading of models (using module scripts/download_ntxdata.py)

log_info(f"To download the models defined in {SETTINGS_DIR / 'downloads'} go to : /{API_PREFIX}/download_models")

@PromptServer.instance.routes.get(f"/{API_PREFIX}/download_models")
async def download_models(request):
    global COMFY_DIR
    global CONFIGURATION
    global SETTINGS_DIR

    cloud_storage_id = CONFIGURATION.get("cloud_storage_id", "pcloud")

    from .scripts.download_ntxdata import main_execution
    result = main_execution(downloads_dir=SETTINGS_DIR / "downloads", models_dir=COMFY_DIR / "models", tokens=CONFIGURATION.get("tokens", {}), simulation_only=False, cloud_storage_id=cloud_storage_id)

    return web.json_response(result)

# Support routes for rescan of models (using module scripts/scan_models.py)

log_info(f"To rescan the models contained in {COMFY_DIR / 'models'} go to : /{API_PREFIX}/rescan_models")

@PromptServer.instance.routes.get(f"/{API_PREFIX}/rescan_models")
async def rescan_models(request):
    global COMFY_DIR
    global CONFIGURATION

    # accept force_rescan from query string
    force_rescan = bool(request.query.get("force_rescan", False))

    # the location of the models dir is retrieved from the configuration file, or defaults to 'models' subdir
    models_dir = Path(CONFIGURATION.get("models_dir_local", ""))
    if models_dir == "":
        # defaults to standard comfy dir
        models_dir = COMFY_DIR / "models"
        # branches to scan (the key and value is the standard comfy name)
        model_types_mapping = {
            "vae": "vae", 
            "checkpoints": "checkpoints",
            "diffusion_models": "diffusion_models",
            "loras": "loras",
        }
    else:
        # branches to scan (the key is the standard comfy name, the value is the actual name of the directory to scan on disk)
        model_types_mapping = {
            "vae": "VAE", 
            "checkpoints": "Checkpoints",
            "diffusion_models": "diffusion_models",
            "loras": "Lora",
        }
    if models_dir.exists():
        log_info(f"Processing {models_dir}")
    else:
        return web.json_response(f"Models dir not found: {models_dir}")

    from .scripts.scan_models import generate_models_catalogue
    result_models = generate_models_catalogue(models_dir=models_dir, model_types_mapping=model_types_mapping, force_rescan=force_rescan)
    log_info(result_models)

    from .scripts.scan_models import generate_chars_catalogue
    result_chars = generate_chars_catalogue()
    log_info(result_chars)

    from .py.loadinfo import g_models_manager
    g_models_manager.load()
    log_info(f"Updated g_models_manager from {g_models_manager.models_file}")

    from .py.loadinfo import g_characters_manager
    g_characters_manager.load()
    log_info(f"Updated g_characters_manager from {g_characters_manager.characters_file}")

    return web.json_response(f"force_rescan={force_rescan}" + "\n" + result_models + "\n" + result_chars)
