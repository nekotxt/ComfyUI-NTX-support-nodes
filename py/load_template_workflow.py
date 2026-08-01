# CREATED WITH CLAUDE OPUS 5

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

from ..config_variables import API_PREFIX, SETTINGS_DIR, TEMPLATES_SUBDIR
from .logging import logger

# ===== WORKFLOW TEMPLATE PRESETS ==========================================================================================================

# User-editable file listing named sets of template workflows, e.g.
#
#   Anima:
#       - 00 new/10 model Anima diffusion
#       - 00 new/20 prompt base
#
# Every key is a preset name (shown in the picker's combobox) and its list holds
# template paths relative to the templates folder scanned by the frontend
# (web/js/load_template_workflow.js). The ".json" extension is optional — the
# frontend matches the entries against the templates it actually found and
# reports the ones that are missing.
PRESETS_FILE = SETTINGS_DIR / "workflow_template_presets.yaml"


def _yaml():
    # round-trip mode keeps the comments and the key order of the hand-edited
    # file when a preset is saved back; the indentation matches the way the file
    # is written by hand ("    - template")
    yaml = YAML(typ="rt")
    yaml.indent(mapping=2, sequence=6, offset=4)
    return yaml


def _read_presets_yaml():
    """The raw parsed presets file as a (round-trip) mapping, or None on any problem."""
    if not PRESETS_FILE.is_file():
        logger.info(f"LoadWfTemplate : no presets file at {PRESETS_FILE}")
        return None

    try:
        with open(PRESETS_FILE, "r", encoding="utf-8") as f:
            data = _yaml().load(f)
    except Exception as e:
        logger.warning(f"LoadWfTemplate : could not read {PRESETS_FILE} : {e}")
        return None

    if data is not None and not isinstance(data, dict):
        logger.warning(f"LoadWfTemplate : {PRESETS_FILE.name} must map preset names to template lists")
        return None
    return data


def load_template_presets():
    """The presets as an ordered [{"name": str, "templates": [str, ...]}, ...] list.

    Read from disk on every call so edits to the file show up without a restart
    (the picker's Refresh button goes through here). A missing file or a broken
    entry is not an error: it just yields fewer presets.
    """
    data = _read_presets_yaml()
    if not isinstance(data, dict):
        return []

    presets = []
    for name, templates in data.items():
        name = str(name).strip()
        if not name:
            continue
        # a single template may be written without the list dashes
        if isinstance(templates, str):
            templates = [templates]
        if not isinstance(templates, (list, tuple)):
            logger.warning(f"LoadWfTemplate : preset '{name}' is not a list of templates, skipped")
            continue
        paths = [str(t).strip() for t in templates if str(t).strip()]
        if not paths:
            continue
        presets.append({"name": name, "templates": paths})

    return presets


def save_template_preset(name, templates, overwrite=False):
    """Write the {name: templates} entry back into the presets file.

    Returns (ok, status, name); the returned name is the one actually used, which
    for an overwrite is the spelling already in the file. Presets are matched
    case-insensitively so saving "anima" over "Anima" updates that preset instead
    of adding a near-duplicate key. status is "exists" when the name is taken and
    `overwrite` was not set — the frontend turns its Save button into an
    Overwrite confirmation on that answer.
    """
    name = str(name or "").strip()
    if not name:
        return (False, "invalid name", name)

    # stored the way the file is written by hand: forward slashes, no extension
    paths = []
    for template in templates or []:
        path = str(template).strip().replace("\\", "/").lstrip("/")
        if path.lower().endswith(".json"):
            path = path[:-len(".json")]
        if path and path not in paths:
            paths.append(path)
    if not paths:
        return (False, "no templates", name)

    data = _read_presets_yaml()
    if data is None:
        # unreadable file: refuse rather than overwrite something we failed to parse
        if PRESETS_FILE.is_file():
            return (False, f"could not read {PRESETS_FILE.name}", name)
        data = CommentedMap()

    existing = next((k for k in data if str(k).strip().lower() == name.lower()), None)
    if existing is not None:
        if not overwrite:
            return (False, "exists", str(existing))
        name = str(existing)

    data[existing if existing is not None else name] = paths

    try:
        PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PRESETS_FILE, "w", encoding="utf-8") as f:
            _yaml().dump(data, f)
    except Exception as e:
        logger.warning(f"LoadWfTemplate : could not save preset '{name}' : {e}")
        return (False, f"could not save : {e}", name)

    logger.info(f"LoadWfTemplate : preset '{name}' saved ({len(paths)} templates)")
    return (True, "saved", name)


# ===== JAVASCRIPT API =====================================================================================================================

from aiohttp import web
from server import PromptServer

@PromptServer.instance.routes.get(f"/{API_PREFIX}/load_template_workflow_subdir")
async def load_template_workflow_subdir_route(request):
    """The "templates_subdir" configuration entry, i.e. the folder (relative to the
    ComfyUI user "workflows" folder) the picker scans for template workflows.
    Separators are normalised for the frontend, which builds userdata paths with
    it; an empty answer means the entry is unset and the whole "workflows" folder
    is scanned."""
    subdir = str(TEMPLATES_SUBDIR or "").replace("\\", "/").strip("/")
    return web.json_response({"subdir": subdir})

@PromptServer.instance.routes.get(f"/{API_PREFIX}/load_template_workflow_presets")
async def load_template_workflow_presets_route(request):
    return web.json_response(load_template_presets())

@PromptServer.instance.routes.post(f"/{API_PREFIX}/save_template_workflow_preset")
async def save_template_workflow_preset_route(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    (ok, status, name) = save_template_preset(
        data.get("name"), data.get("templates"), bool(data.get("overwrite", False)))
    return web.json_response({"ok": ok, "status": status, "name": name})
