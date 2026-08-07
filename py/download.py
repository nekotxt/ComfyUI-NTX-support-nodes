from comfy_api.latest import ComfyExtension, io

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, MODELS_DIR, SETTINGS_DIR, API_TOKENS
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

        if civitai_api_key == "":
            global API_TOKENS
            tokens = API_TOKENS
            civitai_api_key = tokens.get("civitai", "")
        else:
            tokens={"civitai": civitai_api_key}

        logger.info("Attempt to download models:")
        logger.info(f"- models dir: {models_dir}")
        logger.info(f"- civitai api key: {str(len(civitai_api_key)*'*')}")

        result = download_models_from_text_list(text=models_list, models_dir=str(models_dir), tokens=tokens)

        return io.NodeOutput(result)

# ===== MODELS CATALOGUE =====================================================================================================================

# User-maintained catalogue of downloadable models, read by the frontend picker
# (web/js/download.models_list.js) to fill the "Append models" dialog.
MODELS_LIST_FILE = SETTINGS_DIR / "downloads" / "_full_list.txt"

# Ready-made download lists (*.dwlst), offered as a whole by the same dialog.
DOWNLOADS_DIR = SETTINGS_DIR / "downloads"
DOWNLOADS_EXT = ".dwlst"

def parse_models_text(text: str) -> list[dict]:
    """Split a download list text into entries.

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
    block = []

    def flush():
        if block:
            entries.append({"name": block[0], "text": "\n".join(block)})
            block.clear()

    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        if line == "":
            flush()
            continue
        block.append(line)
    flush()

    return entries

def load_models_catalogue() -> list[dict]:
    """Read the models catalogue file into a list of entries."""
    if not MODELS_LIST_FILE.is_file():
        logger.warning(f"DownloadModelsList : models catalogue not found : {MODELS_LIST_FILE}")
        return []

    try:
        text = MODELS_LIST_FILE.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"DownloadModelsList : could not read {MODELS_LIST_FILE} : {e}")
        return []

    entries = parse_models_text(text)
    logger.info(f"DownloadModelsList : {len(entries)} models read from {MODELS_LIST_FILE}")
    return entries

def load_downloads_lists() -> list[dict]:
    """Read every *.dwlst file of SETTINGS_DIR/downloads.

    Each file is a plain download list (same format as the models_list widget)
    and is returned as {"name": <file stem>, "entries": [...]} : the name fills
    the picker combobox, the entries are appended when it gets picked.
    """
    lists = []

    if not DOWNLOADS_DIR.is_dir():
        logger.warning(f"DownloadModelsList : downloads directory not found : {DOWNLOADS_DIR}")
        return lists

    for path in sorted(DOWNLOADS_DIR.glob(f"*{DOWNLOADS_EXT}")):
        try:
            text = path.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"DownloadModelsList : could not read {path} : {e}")
            continue
        lists.append({"name": path.stem, "entries": parse_models_text(text)})

    logger.info(f"DownloadModelsList : {len(lists)} download lists read from {DOWNLOADS_DIR}")
    return lists

# characters no filesystem we target accepts in a file name
INVALID_NAME_CHARS = '\\/:*?"<>|'

def save_downloads_list(name, text, overwrite=False):
    """Write the models_list text of a node as <name>.dwlst in the downloads dir.

    Returns (ok, status, name); the returned name is the one actually used, which
    for an overwrite is the spelling already on disk. Lists are matched
    case-insensitively so saving "anima" over "Anima" replaces that file instead
    of adding a near-duplicate. status is "exists" when the name is taken and
    `overwrite` was not set — the frontend turns its Save button into an
    Overwrite confirmation on that answer.
    """
    name = str(name or "").strip()
    # a typed-in ".dwlst" is the extension we add ourselves, not part of the name
    if name.lower().endswith(DOWNLOADS_EXT):
        name = name[:-len(DOWNLOADS_EXT)].strip()
    # trailing dots and spaces are silently dropped by Windows : refuse them
    # rather than saving under a name the picker would then show differently
    if (not name or name.strip(". ") != name
            or any(c in INVALID_NAME_CHARS for c in name)):
        return (False, "invalid name", name)

    text = str(text or "").strip()
    if not text:
        return (False, "empty list", name)

    existing = None
    if DOWNLOADS_DIR.is_dir():
        existing = next((p for p in DOWNLOADS_DIR.glob(f"*{DOWNLOADS_EXT}")
                         if p.stem.lower() == name.lower()), None)
    if existing is not None:
        if not overwrite:
            return (False, "exists", existing.stem)
        name = existing.stem

    path = DOWNLOADS_DIR / f"{name}{DOWNLOADS_EXT}"
    try:
        DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
    except Exception as e:
        logger.warning(f"DownloadModelsList : could not save list '{name}' : {e}")
        return (False, f"could not save : {e}", name)

    entries = parse_models_text(text)
    logger.info(f"DownloadModelsList : list '{name}' saved ({len(entries)} models) in {path}")
    return (True, "saved", name)

# ===== JAVASCRIPT API =====================================================================================================================

from aiohttp import web
from server import PromptServer

# Re-read from disk on every call : the file is tiny and the picker is expected
# to show whatever the user last saved in it.
@PromptServer.instance.routes.get(f"/{API_PREFIX}/load_models_catalogue")
async def load_models_catalogue_route(request):
    return web.json_response(load_models_catalogue())

@PromptServer.instance.routes.get(f"/{API_PREFIX}/load_downloads_lists")
async def load_downloads_lists_route(request):
    return web.json_response(load_downloads_lists())

@PromptServer.instance.routes.post(f"/{API_PREFIX}/save_downloads_list")
async def save_downloads_list_route(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    (ok, status, name) = save_downloads_list(
        data.get("name"), data.get("text"), bool(data.get("overwrite", False)))
    return web.json_response({"ok": ok, "status": status, "name": name})

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        DownloadModelsList,
    ]
