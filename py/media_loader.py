from comfy_api.latest import io

import folder_paths

import hashlib
import json
import os

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger
from .utils import MEDIA_REFS_TYPE

# ===== Media loader utilities =================================================================================================================

# subfolder of the ComfyUI input directory the loader uploads its files into (the frontend uploads
# through the core /upload/image route with this subfolder, see web/js/media_loader.js)
MEDIA_SUBFOLDER = "ntx_media"

# the slots come in rows : each row holds 3 picture slots, 1 video slot and 1 audio slot, and the
# frontend adds or removes rows with its "Add slots" / "Remove slots" buttons
SLOTS_PER_ROW = {"pictures": 3, "videos": 1, "audios": 1}
DEFAULT_ROWS = 3
MIN_ROWS = 1

# the media_state widget holds a JSON object with the number of rows and one list per kind, each
# list being as long as the kind's slot count (rows x SLOTS_PER_ROW), an empty slot being null and
# a filled one a dict :
#   {"name": "clip.mp4", "file": "ntx_media/clip.mp4", "type": "input"}
# where "file" is the path relative to the ComfyUI folder named by "type", and "name" the original
# file name shown in the slot
def parse_media_state(media_state: str) -> dict[str, list]:
    try:
        state = json.loads(media_state or "{}")
    except Exception:
        state = {}
    if not isinstance(state, dict):
        state = {}
    try:
        rows = max(MIN_ROWS, int(state.get("rows", DEFAULT_ROWS)))
    except (TypeError, ValueError):
        rows = DEFAULT_ROWS
    parsed = {}
    for kind, per_row in SLOTS_PER_ROW.items():
        count = rows * per_row
        slots = state.get(kind)
        if not isinstance(slots, list):
            slots = []
        slots = [slot if isinstance(slot, dict) and slot.get("file") else None for slot in slots]
        # keep the slot positions, pad or trim to the kind's count
        slots = (slots + [None] * count)[:count]
        parsed[kind] = slots
    return parsed

# the annotated file name ("subdir/file.png [input]") understood by folder_paths
def annotated_name(slot: dict) -> str:
    return f"{slot['file']} [{slot.get('type', 'input')}]"

# ===== NODES ==================================================================================================================================

class MediaLoader(io.ComfyNode):
    """Collect a set of reference media (pictures, videos, audios) in one node.

    The node is a set of slots, drawn by the frontend half in web/js/media_loader.js : rows of 3
    picture slots, 1 video slot and 1 audio slot (3 rows by default, added and removed on the node).
    A file is loaded in a slot by dropping it on the slot or by picking it in the file dialog the
    slot opens when clicked ; the file is uploaded in the input/ntx_media directory and a preview is
    displayed in the slot.

    The slots live in the media_state widget, a JSON object the frontend replaces on the node by
    the slot panel that edits it (see parse_media_state for its layout). The node resolves each file and hands
    the whole set out as one media bundle.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}MediaLoader",
            display_name=f"{ADDON_PREFIX} Media Loader",
            description="Collect pictures, videos and audios, loaded by drag and drop or file dialog on the "
                        f"slots ({DEFAULT_ROWS} rows of 3 pictures, 1 video and 1 audio by default, more or less "
                        "rows on demand), into one media bundle.",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                # the slots : the frontend swaps this string widget for its slot panel
                io.String.Input("media_state", default="{}", socketless=True),
            ],
            outputs=[
                MEDIA_REFS_TYPE.Output("media"),
            ],
        )

    @classmethod
    def execute(cls, media_state) -> io.NodeOutput:
        logger.node_name("MediaLoader")

        state = parse_media_state(media_state)
        media = {}
        for kind, slots in state.items():
            media[kind] = []
            for index, slot in enumerate(slots):
                if slot is None:
                    continue
                path = folder_paths.get_annotated_filepath(annotated_name(slot))
                media[kind].append({
                    "slot": index,
                    "name": slot.get("name") or os.path.basename(slot["file"]),
                    "file": slot["file"],
                    "type": slot.get("type", "input"),
                    "path": path,
                })
            logger.info(f"{kind} : {len(media[kind])} / {len(slots)} slots loaded")

        return io.NodeOutput(media)

    @classmethod
    def fingerprint_inputs(cls, media_state):
        # the widget value is part of the cache key already ; what the executor cannot see is the
        # content of the files behind the names, which may be overwritten by a new upload
        state = parse_media_state(media_state)
        digest = hashlib.sha256()
        for kind, slots in state.items():
            for slot in slots:
                if slot is None:
                    digest.update(b"-")
                    continue
                path = folder_paths.get_annotated_filepath(annotated_name(slot))
                digest.update(slot["file"].encode("utf-8"))
                try:
                    stat = os.stat(path)
                    digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8"))
                except OSError:
                    digest.update(b"missing")
        return digest.hexdigest()

    @classmethod
    def validate_inputs(cls, media_state):
        state = parse_media_state(media_state)
        for kind, slots in state.items():
            for index, slot in enumerate(slots):
                if slot is None:
                    continue
                if not folder_paths.exists_annotated_filepath(annotated_name(slot)):
                    return f"Missing {kind[:-1]} file in slot {index + 1} : {slot['file']}"
        return True

# ===== INITIALIZATION =========================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        MediaLoader,
    ]
