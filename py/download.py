from comfy_api.latest import ComfyExtension, io

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, MODELS_DIR, SETTINGS_DIR
from .logging import logger

from ..scripts.ms_download_models import download_models_from_text_list

class DownloadModelsList(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}DownloadModelsList",
            display_name=f"{ADDON_PREFIX} Download Models List",
            description="",
            category=f"{ADDON_CATEGORY}/utils",
            is_output_node=True,
            inputs=[
                io.String.Input("models_list", multiline=True, dynamic_prompts=False, default=""),
                io.String.Input("models_dir", multiline=False, dynamic_prompts=False, default=""),
                io.String.Input("civitai_api_key", multiline=False, dynamic_prompts=False, default=""),
            ],
            outputs=[
                io.String.Output("result")
            ],
        )

    @classmethod
    def execute(cls, models_list="", models_dir="", civitai_api_key=""):
        if models_dir == "":
            global MODELS_DIR
            models_dir = MODELS_DIR

        logger.info("Attempt to download models:")
        logger.info(f"- models dir: {models_dir}")
        logger.info(f"- civitai api key: {str(len(civitai_api_key)*'*')}")

        result = download_models_from_text_list(text=models_list, models_dir=str(models_dir), tokens={"civitai": civitai_api_key})

        return io.NodeOutput(result)

# ===== MODELS CATALOGUE =====================================================================================================================

# User-maintained catalogue of downloadable models, read by the frontend picker
# (web/js/download.models_list.js) to fill the "Append models" dialog.
MODELS_LIST_FILE = SETTINGS_DIR / "list_of_downloadable_models.txt"

def load_models_catalogue() -> list[dict]:
    """Read the models catalogue file into a list of entries.

    Blocks are separated by empty lines and follow the same format the node
    itself consumes :

        checkpoints/FLUX/flux1-dev-fp8.safetensors
        hash:8E91B68...
        https://civitai.com/api/download/models/1434485

    Each entry is returned as {"name": <first line>, "text": <whole block>} :
    the name is the model subpath shown in the picker tree, the text is what
    gets appended to the models_list widget. Comment lines (#) are dropped.
    """
    entries = []

    if not MODELS_LIST_FILE.is_file():
        logger.warning(f"DownloadModelsList : models catalogue not found : {MODELS_LIST_FILE}")
        return entries

    try:
        with open(MODELS_LIST_FILE, "r", encoding="utf-8") as f:
            raw_lines = f.read().splitlines()
    except Exception as e:
        logger.warning(f"DownloadModelsList : could not read {MODELS_LIST_FILE} : {e}")
        return entries

    block = []

    def flush():
        if block:
            entries.append({"name": block[0], "text": "\n".join(block)})
            block.clear()

    for raw in raw_lines:
        line = raw.strip()
        if line.startswith("#"):
            continue
        if line == "":
            flush()
            continue
        block.append(line)
    flush()

    logger.info(f"DownloadModelsList : {len(entries)} models read from {MODELS_LIST_FILE}")
    return entries

# ===== JAVASCRIPT API =====================================================================================================================

from aiohttp import web
from server import PromptServer

# Re-read from disk on every call : the file is tiny and the picker is expected
# to show whatever the user last saved in it.
@PromptServer.instance.routes.get(f"/{API_PREFIX}/load_models_catalogue")
async def load_models_catalogue_route(request):
    return web.json_response(load_models_catalogue())

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        DownloadModelsList,
    ]
