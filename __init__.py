import sys

from pathlib import Path

from .py.utils import is_string_empty

ADDON_NAME = "NTX-support-nodes"
ADDON_PREFIX = "NTX"
ADDON_CATEGORY = "NTXUtils"
API_PREFIX = "ntx-sn"

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

# logging
from .py.logging import log_setup
log_setup(addon_name=ADDON_NAME, log_info=True, log_info_node_name=True, log_info_load_model=True, log_info_apply_model=True, log_warning=True)

NODE_LIST = {}

from .py.images import NODE_LIST as IMAGES_NODE_LIST
NODE_LIST.update(IMAGES_NODE_LIST)

from .py.loadinfo import NODE_LIST as LOADINFO_NODE_LIST
NODE_LIST.update(LOADINFO_NODE_LIST)

from .py.pipe import NODE_LIST as PIPE_NODE_LIST
NODE_LIST.update(PIPE_NODE_LIST)

from .py.utils import NODE_LIST as UTILS_NODE_LIST
NODE_LIST.update(UTILS_NODE_LIST)

def generate_node_mappings(node_config):
    node_class_mappings = {}
    node_display_name_mappings = {}

    for node_name, node_class in node_config.items():
        full_name = f"{ADDON_PREFIX}{node_name}"
        node_class_mappings[full_name] = node_class
        node_display_name_mappings[full_name] = full_name
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

# Support routes for node LoadCharInfo

@PromptServer.instance.routes.post(f"/{API_PREFIX}/get_options_for_char")
async def get_options_for_char(request):
    data = await request.json()
    char_name = data.get("char_name", "")
    
    from .py.loadinfo import get_options_for_char
    options_for_char = get_options_for_char(char_name=char_name)

    return web.json_response({"options_for_char": options_for_char})

@PromptServer.instance.routes.post(f"/{API_PREFIX}/get_prompt_for_char_option")
async def get_prompt_for_char_option(request):
    data = await request.json()
    char_name = data.get("char_name", "")
    option_name = data.get("option_name", "")
    
    from .py.loadinfo import get_prompt_for_char_option
    prompt_data = get_prompt_for_char_option(char_name=char_name, option_name=option_name)

    return web.json_response(prompt_data)
