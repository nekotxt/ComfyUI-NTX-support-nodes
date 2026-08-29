import json
import sys

from pathlib import Path

from ruamel.yaml import YAML
yaml = YAML(typ='safe', pure=True)

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

MODEL_TYPES = ["vae", "checkpoints", "loras"]
MODELS_DIR = Path.cwd() / "models"

# user configuration files

class SettingsSolver():
    """Resolve the settings files and directories of the node pack.

    Every setting is looked up in the user directory first (input/ntx_data of the
    ComfyUI installation) and falls back to the ntx_data directory shipped with the
    node pack. The choice is made per file / directory, so a user directory holding
    a single overridden file still gets every other setting from the node pack.

    When the setting exists in neither location the user path is returned, so
    anything created later on (a saved preset, a new directory) lands in the user
    directory rather than inside the node pack.
    """

    def __init__(self, user_dir:Path, addon_dir:Path):
        self.user_dir = user_dir
        self.addon_dir = addon_dir

    def solve_path(self, subpath:str, force_user:bool=False) -> Path:
        # the user copy wins as soon as it exists, whatever it is (file or directory)
        user_path = self.user_dir / subpath
        if force_user:
            return user_path
        if user_path.exists():
            return user_path
        addon_path = self.addon_dir / subpath
        if addon_path.exists():
            return addon_path
        # nothing to read anywhere : point at the user directory, where new files go
        return user_path

SETTINGS_SOLVER = SettingsSolver(Path.cwd() / "input" / "ntx_data", Path(__file__).parent / "ntx_data")
print(f"[INFO] [{ADDON_NAME}] Load settings from {SETTINGS_SOLVER.user_dir}, with fallback on {SETTINGS_SOLVER.addon_dir}")

CONFIGURATION = {}
configuration_file = SETTINGS_SOLVER.solve_path("config.yaml")
if configuration_file.is_file():
    try:
        configuration_text = configuration_file.read_text(encoding="utf-8")
        CONFIGURATION = yaml.load(configuration_text)
    except Exception as e:
        print(f"[WARN] [{ADDON_NAME}] Error loading configuration file {configuration_file} : {e}")
else:
    logger.warning(f"[WARN] [{ADDON_NAME}] Configuration file not found {configuration_file}")

INCLUDE_MODELS_FROM_CATALOGUE = CONFIGURATION.get("include_models_from_catalogue", False)
MAX_CACHED_LORAS = CONFIGURATION.get("cache", {}).get("max_loras", 5)
DOWNLOAD_MISSING_LORAS = CONFIGURATION.get("download_missing_loras", False) and sys.platform.lower().startswith("linux") # only download for linux (pods)
CLOUD_STORAGE_ID = CONFIGURATION.get("cloud_storage_id", "")
API_TOKENS = CONFIGURATION.get("tokens", {})
TEMPLATES_SUBDIR = CONFIGURATION.get("templates_subdir", "")
