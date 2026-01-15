# get a reference to the custom_nodes dir
import sys
from pathlib import Path
COMFY_DIR = Path.cwd()
if not COMFY_DIR in sys.path:
    sys.path.append(COMFY_DIR)
COMFY_EXTRAS_DIR = COMFY_DIR / "comfy_extras"
if not COMFY_EXTRAS_DIR in sys.path:
    sys.path.append(COMFY_EXTRAS_DIR)

# custom_nodes_dir = Path(__file__)
# while custom_nodes_dir.stem != "custom_nodes":
#     new_custom_nodes_dir = custom_nodes_dir.parent
#     if new_custom_nodes_dir == custom_nodes_dir:
#         custom_nodes_dir = ""
#         break
#     custom_nodes_dir = new_custom_nodes_dir

# # add references to the main comfy dirs (to load core nodes)
# if custom_nodes_dir != "":
#     comfy_dir = str(custom_nodes_dir.parent)
#     if not comfy_dir in sys.path:
#         sys.path.append(comfy_dir)
#     comfy_extras_dir = str(custom_nodes_dir.parent / "comfy_extras")
#     if not comfy_extras_dir in sys.path:
#         sys.path.append(comfy_extras_dir)

from .py.utils import is_string_empty

ADDON_PREFIX = "NTX"
ADDON_CATEGORY = "NTXUtils"
API_PREFIX = "ntx-sn"

# ===== INITIALIZATION =====================================================================================================================

NODE_LIST = {}

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
