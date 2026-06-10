from comfy_api.latest import ComfyExtension, io, ui

import json

from pathlib import Path

from .config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, COMFY_DIR, SETTINGS_DIR
from .py.logging import logger#log_setup, log_info, log_warning
logger.info("Initialization ...")

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
                nodes_text = ""
                for node in module_nodes:
                    nodes_text += " " + node.__name__
                logger.info(f"Loaded {len(module_nodes)} nodes from module {module_name} : {nodes_text}")

        return list_of_nodes

# can be declared async or not, both will work
async def comfy_entrypoint() -> NTX_SE_Extension:
    return NTX_SE_Extension()

# ===== JAVASCRIPT API =====================================================================================================================

# Set the web directory, any .js file in that directory will be loaded by the frontend as a frontend extension
WEB_DIRECTORY = "./web"

