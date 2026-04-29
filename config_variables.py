import json
import sys

from pathlib import Path

ADDON_NAME = "NTX-support-nodes"
ADDON_PREFIX = "NTX"
ADDON_CATEGORY = "NTX-support-nodes"
API_PREFIX = "ntx-sn"

LOG_INFO = True
LOG_INFO_NODE_NAME = True
LOG_INFO_LOAD_MODEL = True
LOG_INFO_APPLY_MODEL = True
LOG_WARNING = True

# get a reference to the custom_nodes dir
COMFY_DIR = Path.cwd()
COMFY_DIR_str = str(COMFY_DIR)
if not COMFY_DIR_str in sys.path:
    sys.path.append(COMFY_DIR_str)
COMFY_EXTRAS_DIR = COMFY_DIR / "comfy_extras"
COMFY_EXTRAS_DIR_str = str(COMFY_EXTRAS_DIR)
if not COMFY_EXTRAS_DIR_str in sys.path:
    sys.path.append(COMFY_EXTRAS_DIR_str)

SETTINGS_DIR = Path.cwd() / "input" / "ntx_data"
SETTINGS_DIR.mkdir(parents=True, exist_ok=True)

MODEL_TYPES = ["vae", "checkpoints", "loras"]

# user configuration file
CONFIGURATION = {}
configuration_file = SETTINGS_DIR / "config.json"
if configuration_file.is_file():
    with open(configuration_file,'r', encoding='utf-8') as f:
        CONFIGURATION = json.load(f)
