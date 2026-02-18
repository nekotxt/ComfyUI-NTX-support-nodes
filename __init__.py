import json
import sys

from pathlib import Path

from .py.logging import log_info, log_warning
from .py.utils import is_string_empty, clone_data, load_list_vaes, load_list_samplers, load_list_schedulers

ADDON_NAME = "NTX-support-nodes"
ADDON_PREFIX = "NTX"
ADDON_CATEGORY = "NTXUtils"
API_PREFIX = "ntx-sn"

SETTINGS_DIR = Path.cwd() / "input" / "ntx_data"
SETTINGS_DIR.mkdir(parents=True, exist_ok=True)

# ===== INITIALIZATION =====================================================================================================================

# get a reference to the custom_nodes dir
COMFY_DIR = Path.cwd()
COMFY_DIR_str = str(COMFY_DIR)
if not COMFY_DIR_str in sys.path:
    sys.path.append(COMFY_DIR_str)
COMFY_EXTRAS_DIR = COMFY_DIR / "comfy_extras"
COMFY_EXTRAS_DIR_str = str(COMFY_EXTRAS_DIR)
if not COMFY_EXTRAS_DIR_str in sys.path:
    sys.path.append(COMFY_EXTRAS_DIR_str)

# configuration file
CONFIGURATION = {}
configuration_file = SETTINGS_DIR / "config.json"
if configuration_file.is_file():
    with open(configuration_file,'r', encoding='utf-8') as f:
        CONFIGURATION = json.load(f)

# logging
from .py.logging import log_setup
log_setup(addon_name=ADDON_NAME, show_info=True, show_info_node_name=True, show_info_load_model=True, show_info_apply_model=True, show_warning=True)

NODE_LIST = {}

from .py.images import NODE_LIST as IMAGES_NODE_LIST
NODE_LIST.update(IMAGES_NODE_LIST)

from .py.loadinfo import NODE_LIST as LOADINFO_NODE_LIST
NODE_LIST.update(LOADINFO_NODE_LIST)

from .py.pipe import NODE_LIST as PIPE_NODE_LIST
NODE_LIST.update(PIPE_NODE_LIST)

from .py.utils import NODE_LIST as UTILS_NODE_LIST, util_setup
NODE_LIST.update(UTILS_NODE_LIST)
util_setup(max_cached_loras=CONFIGURATION.get("cache", {}).get("max_loras", 8))

def generate_node_mappings(node_config):
    node_class_mappings = {}
    node_display_name_mappings = {}

    for node_name, node_class in node_config.items():
        full_name = f"{ADDON_PREFIX}{node_name}"
        if isinstance(node_class, list):
            node_class, node_display_name = node_class[0], f"{ADDON_PREFIX}{node_class[1]}"
        else:
            node_display_name = full_name

        node_class_mappings[full_name] = node_class
        node_display_name_mappings[full_name] = node_display_name
        if is_string_empty(node_class.CATEGORY):
            node_class.CATEGORY = ADDON_CATEGORY
        else:
            node_class.CATEGORY = f"{ADDON_CATEGORY}/{node_class.CATEGORY}"

    return node_class_mappings, node_display_name_mappings

NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = generate_node_mappings(NODE_LIST)

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

# Support routes for downloading of models

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
