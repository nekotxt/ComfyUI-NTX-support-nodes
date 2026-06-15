from comfy_api.latest import ComfyExtension, io, ui

from ruamel.yaml import YAML

import numpy as np
import torch
from PIL import Image, ImageOps

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, SETTINGS_DIR
from .logging import logger

# ===== PROMPT LIBRARY =====================================================================================================================

# directory holding the nested prompt library files. Every *.yaml / *.yml file in
# here is scanned and merged: dictionary keys are treated as nested categories and
# list items as the leaves of the tree.
PROMPTS_DIR = SETTINGS_DIR / "prompts"

# shown in the combobox when the file is missing or empty, so the node still loads
NO_PROMPTS_OPTION = "(no prompts found)"

# image extensions looked up (in order) next to a prompt id, e.g. scenes/fantasy/dungeon.png
IMAGE_EXTENSIONS = (".png", ".jpeg", ".jpg")

# name separator to be used in leaf strings to identify a name
NAME_SEPARATOR = "::"


def _flatten_prompts(node, prefix, out):
    """Recursively walk the parsed YAML, building an ordered {id: prompt} map.
    Dict keys extend the category path; only list items become leaves. A list item
    is either a plain string (used both as the combobox label and the prompt), or a
    dictionary with a "name" key (shown in the combobox) and a "positive" key (the
    prompt text). e.g. clothing: [T-shirt] -> {"clothing/T-shirt": "T-shirt"}.
    Bare scalars (a key mapping to a single value) are ignored."""
    if isinstance(node, dict):
        for key, value in node.items():
            new_prefix = f"{prefix}/{key}" if prefix else str(key)
            _flatten_prompts(value, new_prefix, out)
    elif isinstance(node, (list, tuple)):
        for item in node:
            if isinstance(item, dict) and "name" in item:
                leaf = str(item["name"])
                key = f"{prefix}/{leaf}" if prefix else leaf
                out[key] = str(item.get("positive", leaf))
            elif isinstance(item, (dict, list, tuple)):
                _flatten_prompts(item, prefix, out)
            else:
                leaf = str(item)
                text = leaf
                if NAME_SEPARATOR in leaf:
                    leaf, text = leaf.split(NAME_SEPARATOR, 1)
                key = f"{prefix}/{leaf}" if prefix else leaf
                out[key] = text


# cached result of _build_prompts_map(); populated lazily on the first
# load_prompts_map() call. Call reload_prompts_map() to rebuild from disk.
_PROMPTS_CACHE = None


def load_prompts_map():
    """Return the merged {id: prompt} map, building it from disk on first use and
    caching it afterwards. Use reload_prompts_map() to pick up file changes."""
    global _PROMPTS_CACHE
    if _PROMPTS_CACHE is None:
        _PROMPTS_CACHE = _build_prompts_map()
    return _PROMPTS_CACHE


def reload_prompts_map():
    """Discard the cache and rebuild the map from disk on the next access."""
    global _PROMPTS_CACHE
    _PROMPTS_CACHE = _build_prompts_map()
    return _PROMPTS_CACHE


def _build_prompts_map():
    """Build a single merged, ordered {id: prompt} dict from PROMPTS_DIR.

    Two sources are combined:
    - every *.yaml / *.yml file in PROMPTS_DIR (top level), flattened into category
      paths; files sharing a structure accumulate under the same path (e.g.
      artists/finnish/Jarno Trulli from one file joins artists/finnish from another).
    - every *.txt file found recursively inside SUBDIRECTORIES of PROMPTS_DIR
      (.txt files sitting directly in PROMPTS_DIR are ignored); the file's relative
      path without extension becomes the id and its text content the prompt, e.g.
      scenes/fantasy/castle.txt -> {"scenes/fantasy/castle": "<file content>"}."""
    out = {}
    if not PROMPTS_DIR.is_dir():
        logger.warning(f"LoadPrompt : prompts directory not found : {PROMPTS_DIR}")
        return out

    # YAML files (top level only)
    yaml = YAML(typ="rt")
    for path in sorted(PROMPTS_DIR.glob("*.yaml")) + sorted(PROMPTS_DIR.glob("*.yml")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.load(f)
            if data is not None:
                _flatten_prompts(data, "", out)
        except Exception as e:
            logger.warning(f"LoadPrompt : could not read prompts file {path.name} : {e}")

    # TXT files inside subdirectories (recursive); those directly in PROMPTS_DIR are ignored
    for path in sorted(PROMPTS_DIR.rglob("*.txt")):
        rel = path.relative_to(PROMPTS_DIR)
        if len(rel.parts) < 2:
            continue  # directly in PROMPTS_DIR — skip
        key = rel.with_suffix("").as_posix()
        try:
            out[key] = path.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"LoadPrompt : could not read prompt file {rel.as_posix()} : {e}")

    if not out:
        logger.warning(f"LoadPrompt : no prompts found in : {PROMPTS_DIR}")
    return out


def load_prompt_ids():
    """The list of leaf ids used to populate the combobox."""
    ids = list(load_prompts_map().keys())
    ids.sort()
    return ids if ids else [NO_PROMPTS_OPTION]


# ===== PROMPT IMAGES ======================================================================================================================

def find_prompt_image(id):
    """Return the Path of the image sitting next to the given prompt id (matching
    name, one of IMAGE_EXTENSIONS), or None if no such file exists. The lookup is
    confined to PROMPTS_DIR so an id cannot reach files outside the library."""
    if not id:
        return None
    base = PROMPTS_DIR.joinpath(*id.split("/"))
    try:
        base.resolve().relative_to(PROMPTS_DIR.resolve())
    except ValueError:
        logger.warning(f"LoadPrompt : ignoring out-of-library id : {id}")
        return None
    for ext in IMAGE_EXTENSIONS:
        candidate = base.with_name(base.name + ext)
        if candidate.is_file():
            return candidate
    return None


def load_image_as_tensor(path):
    """Load an image file into a ComfyUI IMAGE tensor of shape [1, H, W, 3], float32 0..1."""
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None, ]


# ===== NODES ==============================================================================================================================

class LoadPrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadPrompt",
            display_name=f"{ADDON_PREFIX} Load Prompt",
            description="Pick a prompt from the nested library in input/ntx_data/prompts/test.yaml; the text can be edited before use.",
            category=f"{ADDON_CATEGORY}/prompts",
            inputs=[
                io.Combo.Input("id", options=load_prompt_ids()),
                io.String.Input("prompt", multiline=True, default=""),
            ],
            outputs=[
                io.String.Output("prompt"),
                io.String.Output("id"),
                io.Image.Output("image"),
            ],
        )

    @classmethod
    def execute(cls, id, prompt):
        # the frontend fills the prompt box from the selected id, but fall back to
        # the library text when it is empty (e.g. headless / API execution)
        if not prompt or prompt.isspace():
            prompt = load_prompts_map().get(id, "")

        # look for an image with the same name as the id; return None if missing
        image = None
        image_path = find_prompt_image(id)
        if image_path is not None:
            try:
                image = load_image_as_tensor(image_path)
            except Exception as e:
                logger.warning(f"LoadPrompt : could not load image {image_path.name} : {e}")

        return io.NodeOutput(prompt, id, image)


# ===== SAVING PROMPTS =====================================================================================================================

def prompt_target_paths(category, name):
    """Build the (txt_path, png_path) a prompt with the given category/name would be
    saved to, e.g. category="scenes/fantasy", name="lake" -> scenes/fantasy/lake.{txt,png}.
    Returns None when the name is empty or the target would fall outside PROMPTS_DIR."""
    name = (name or "").strip().strip("/")
    cat_parts = [p for p in (category or "").split("/") if p.strip()]
    if not name:
        return None
    base = PROMPTS_DIR.joinpath(*cat_parts, name)
    try:
        base.resolve().relative_to(PROMPTS_DIR.resolve())
    except ValueError:
        return None
    return (base.with_name(base.name + ".txt"), base.with_name(base.name + ".png"))


def save_tensor_as_png(image, path):
    """Save a ComfyUI IMAGE tensor ([B,H,W,C] or [H,W,C], float 0..1) as a PNG (first frame)."""
    img = image[0] if image.ndim == 4 else image
    arr = (img.clamp(0.0, 1.0).cpu().numpy() * 255.0).round().astype(np.uint8)
    Image.fromarray(arr).save(path)


def save_prompt_files(category, name, prompt, image=None, overwrite=False):
    """Write the prompt text (and the image, if given) to the library.
    Returns (ok, status); status is "saved", "exists" (txt present and not overwrite),
    or an error message."""
    paths = prompt_target_paths(category, name)
    if paths is None:
        return (False, "invalid category/name")
    txt_path, png_path = paths

    if txt_path.exists() and not overwrite:
        return (False, "exists")

    try:
        txt_path.parent.mkdir(parents=True, exist_ok=True)
        txt_path.write_text(prompt or "", encoding="utf-8")
        if image is not None:
            save_tensor_as_png(image, png_path)
    except Exception as e:
        return (False, f"could not save : {e}")

    # the library changed on disk — drop the cache so the new entry shows up
    global _PROMPTS_CACHE
    _PROMPTS_CACHE = None
    return (True, "saved")


def notify_user(severity, summary, detail):
    """Best-effort toast on the frontend (see web/js listener); never fatal."""
    try:
        PromptServer.instance.send_sync(
            f"{API_PREFIX}.toast",
            {"severity": severity, "summary": summary, "detail": detail},
        )
    except Exception:
        pass


class SavePrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SavePrompt",
            display_name=f"{ADDON_PREFIX} Save Prompt",
            description="Save a prompt (and an optional image) into the library under category/name, e.g. scenes/fantasy/lake.txt (+ .png).",
            category=f"{ADDON_CATEGORY}/prompts",
            is_output_node=True,
            inputs=[
                io.String.Input("category", default=""),
                io.String.Input("name", default=""),
                io.String.Input("prompt", multiline=True, default=""),
                io.Boolean.Input("overwrite", default=False),
                io.Image.Input("image", optional=True),
            ],
            outputs=[],
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        # always re-run so the file is (re)written every time the node is executed
        return float("nan")

    @classmethod
    def execute(cls, category, name, prompt, overwrite=False, image=None):
        ok, status = save_prompt_files(category, name, prompt, image, overwrite)
        target = f"{category.strip('/')}/{name}".strip("/") if name else "(unnamed)"

        if ok:
            logger.info(f"SavePrompt : saved {target}")
            return io.NodeOutput(ui=ui.PreviewText(f"Saved {target}"))

        if status == "exists":
            msg = f"'{target}' already exists — not saved (enable 'overwrite' to replace it)"
            logger.warning(f"SavePrompt : {msg}")
            notify_user("warn", "Save Prompt", msg)
            return io.NodeOutput(ui=ui.PreviewText(msg))

        msg = f"could not save '{target}' : {status}"
        logger.warning(f"SavePrompt : {msg}")
        notify_user("error", "Save Prompt", msg)
        return io.NodeOutput(ui=ui.PreviewText(msg))


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        LoadPrompt,
        SavePrompt,
    ]

# ===== JAVASCRIPT API =====================================================================================================================

from aiohttp import web
from server import PromptServer

@PromptServer.instance.routes.get(f"/{API_PREFIX}/load_prompts")
async def load_prompts_route(request):
    return web.json_response(load_prompts_map())

@PromptServer.instance.routes.post(f"/{API_PREFIX}/reload_prompts")
async def reload_prompts_route(request):
    return web.json_response(reload_prompts_map())
