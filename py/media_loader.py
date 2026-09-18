from comfy_api.latest import io

import av
import folder_paths
import numpy as np

import asyncio
import hashlib
import json
import os
import re
from pathlib import Path

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX
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
# file name shown in the slot. A picture, a video or an audio may carry the edits recorded by the
# frontend editors (web/js/media_loader.editor.js, media_loader.video_editor.js,
# media_loader.audio_editor.js), as an "edit" dict, see normalize_edit, normalize_video_edit and
# normalize_audio_edit
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

# the edits a picture may carry, and the order they are meant to be applied in :
#   1. rotate the original picture clockwise by "rotate" degrees (0, 90, 180, 270)
#   2. mirror it horizontally ("mirror_h") and / or vertically ("mirror_v")
#   3. crop it to "crop" = {x, y, width, height}, in pixels of the rotated and mirrored picture
#      (None : no crop)
#   4. scale it down so that its longer side is at most "max_size" pixels (0 : no limit)
# The loader only records these settings, it never touches the file : applying them is up to the
# node consuming the bundle
EDIT_ROTATIONS = (0, 90, 180, 270)
EDIT_MAX_SIZES = (0, 512, 832, 1024, 1280, 1600, 1920, 2048)

def normalize_edit(edit) -> dict:
    result = {"rotate": 0, "mirror_h": False, "mirror_v": False, "crop": None, "max_size": 0}
    if not isinstance(edit, dict):
        return result
    try:
        rotate = int(edit.get("rotate", 0))
    except (TypeError, ValueError):
        rotate = 0
    if rotate in EDIT_ROTATIONS:
        result["rotate"] = rotate
    result["mirror_h"] = bool(edit.get("mirror_h"))
    result["mirror_v"] = bool(edit.get("mirror_v"))
    crop = edit.get("crop")
    if isinstance(crop, dict):
        try:
            rect = {key: int(round(float(crop.get(key, 0)))) for key in ("x", "y", "width", "height")}
            if rect["width"] > 0 and rect["height"] > 0 and rect["x"] >= 0 and rect["y"] >= 0:
                result["crop"] = rect
        except (TypeError, ValueError):
            pass
    try:
        max_size = int(edit.get("max_size", 0))
    except (TypeError, ValueError):
        max_size = 0
    if max_size in EDIT_MAX_SIZES:
        result["max_size"] = max_size
    return result

def is_edited(edit: dict) -> bool:
    return edit["rotate"] != 0 or edit["mirror_h"] or edit["mirror_v"] or edit["crop"] is not None or edit["max_size"] != 0

# the edits a video may carry, and the order they are meant to be applied in :
#   1. keep only the span from "start" to "end" seconds (None : up to the end of the video)
#   2. mirror the frames horizontally ("mirror_h") and / or vertically ("mirror_v")
#   3. crop them to "crop" = {x, y, width, height}, in pixels of the mirrored frame (None : no crop)
#   4. scale them down so that the longer side is at most "max_size" pixels (0 : no limit)
def normalize_video_edit(edit) -> dict:
    result = {"mirror_h": False, "mirror_v": False, "crop": None, "max_size": 0, "start": 0.0, "end": None}
    if not isinstance(edit, dict):
        return result
    # the frame edits are the picture ones without the rotation
    frame = normalize_edit({key: edit.get(key) for key in ("mirror_h", "mirror_v", "crop", "max_size")})
    for key in ("mirror_h", "mirror_v", "crop", "max_size"):
        result[key] = frame[key]
    result.update(normalize_span(edit))
    return result

def is_video_edited(edit: dict) -> bool:
    return (edit["mirror_h"] or edit["mirror_v"] or edit["crop"] is not None or edit["max_size"] != 0
            or edit["start"] > 0 or edit["end"] is not None)

# the time span an audio may carry : keep only "start" to "end" seconds (None : up to the end)
def normalize_span(edit) -> dict:
    result = {"start": 0.0, "end": None}
    if not isinstance(edit, dict):
        return result
    try:
        start = float(edit.get("start", 0) or 0)
    except (TypeError, ValueError):
        start = 0.0
    if start > 0:
        result["start"] = round(start, 3)
    end = edit.get("end")
    if end is not None:
        try:
            end = float(end)
        except (TypeError, ValueError):
            end = None
    if end is not None and end > result["start"]:
        result["end"] = round(end, 3)
    return result

def normalize_audio_edit(edit) -> dict:
    return normalize_span(edit)

def is_audio_edited(edit: dict) -> bool:
    return edit["start"] > 0 or edit["end"] is not None

# ===== NODES ==================================================================================================================================

class MediaLoader(io.ComfyNode):
    """Collect a set of reference media (pictures, videos, audios) in one node.

    The node is a set of slots, drawn by the frontend half in web/js/media_loader.js : rows of 3
    picture slots, 1 video slot and 1 audio slot (3 rows by default, added and removed on the node).
    A file is loaded in a slot by dropping it on the slot or by picking it in the file dialog the
    slot opens when clicked ; the file is uploaded in the input/ntx_media directory and a preview is
    displayed in the slot.

    A picture can also be edited on the node (rotate, mirror, crop, max size), and so can a video
    (time range, mirror, crop, max size) and an audio (time range) : the editors record the settings
    on the slot, the file is never touched, and the settings travel with the media in the bundle
    (see normalize_edit, normalize_video_edit and normalize_audio_edit) for the consuming node to
    apply.

    The slots live in the media_state widget, a JSON object the frontend replaces on the node by
    the slot panel that edits it (see parse_media_state for its layout). The node resolves each file
    and hands the whole set out as one media bundle.
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
                entry = {
                    "slot": index,
                    "name": slot.get("name") or os.path.basename(slot["file"]),
                    "file": slot["file"],
                    "type": slot.get("type", "input"),
                    "path": path,
                }
                if kind == "pictures":
                    entry["edit"] = normalize_edit(slot.get("edit"))
                elif kind == "videos":
                    entry["edit"] = normalize_video_edit(slot.get("edit"))
                else:
                    entry["edit"] = normalize_audio_edit(slot.get("edit"))
                media[kind].append(entry)
            check = {"pictures": is_edited, "videos": is_video_edited, "audios": is_audio_edited}[kind]
            edited = sum(1 for entry in media[kind] if "edit" in entry and check(entry["edit"]))
            logger.info(f"{kind} : {len(media[kind])} / {len(slots)} slots loaded"
                        + (f", {edited} edited" if edited else ""))

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

# ===== AUDIO EXTRACTION =======================================================================================================================

# the "Save audio" command of the video editor : the audio of the kept span is written as a FLAC
# file in the loader's input subfolder, to be loaded in an audio slot

# a file name safe to write in the input subfolder
def safe_name(name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(name or "")).strip("._") or "audio"
    return name[:120]

# a name not yet used in the directory, "name (n).ext" style like the core upload route
def unique_path(directory: Path, name: str) -> Path:
    stem, ext = os.path.splitext(name)
    path = directory / name
    counter = 1
    while path.exists():
        path = directory / f"{stem} ({counter}){ext}"
        counter += 1
    return path

# decode the audio of a video between start and end seconds (end None : to the end), as a float32
# array [C, T] and its sample rate ; None when the video has no audio stream
def decode_audio_span(video_path: str, start: float, end: float | None):
    with av.open(video_path) as container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            return None, 0
        rate = int(stream.rate)
        channels = 1 if stream.layout.nb_channels == 1 else 2
        layout = "mono" if channels == 1 else "stereo"
        resampler = av.AudioResampler(format="fltp", layout=layout, rate=rate)
        # land a little before the span : seeking stops on a keyframe, the frames are then trimmed
        if start > 0:
            try:
                container.seek(int(max(0.0, start - 1.0) * av.time_base), backward=True)
            except Exception:
                pass
        chunks = []
        cursor = None
        for frame in container.decode(stream):
            if cursor is None or frame.time is not None:
                cursor = frame.time if frame.time is not None else (cursor or 0.0)
            for out in resampler.resample(frame):
                samples = out.to_ndarray()                    # [C, n] for a planar format
                n = samples.shape[1]
                t0 = out.time if out.time is not None else cursor
                t1 = t0 + n / rate
                cursor = t1
                if end is not None and t0 >= end:
                    break
                if t1 <= start:
                    continue
                i0 = max(0, int(round((start - t0) * rate)))
                i1 = n if end is None else min(n, int(round((end - t0) * rate)))
                if i1 > i0:
                    chunks.append(samples[:, i0:i1])
            if end is not None and cursor is not None and cursor >= end:
                break
        if not chunks:
            return np.zeros((channels, 0), dtype=np.float32), rate
        return np.concatenate(chunks, axis=1).astype(np.float32), rate

# write a float32 [C, T] array as a FLAC file
def write_flac(samples: np.ndarray, rate: int, file_path: Path):
    layout = "mono" if samples.shape[0] == 1 else "stereo"
    with av.open(str(file_path), mode="w", format="flac") as container:
        stream = container.add_stream("flac", rate=rate, layout=layout)
        frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(samples.T).reshape(1, -1), format="flt", layout=layout)
        frame.sample_rate = rate
        frame.pts = 0
        container.mux(stream.encode(frame))
        container.mux(stream.encode(None))

def extract_audio(file: str, file_type: str, start: float, end: float | None) -> dict:
    annotated = f"{file} [{file_type}]"
    if not folder_paths.exists_annotated_filepath(annotated):
        raise FileNotFoundError(f"missing video file : {file}")
    video_path = folder_paths.get_annotated_filepath(annotated)
    samples, rate = decode_audio_span(video_path, start, end)
    if samples is None:
        raise ValueError("this video has no audio track")
    if samples.shape[1] == 0:
        raise ValueError("no audio in the kept span")
    directory = Path(folder_paths.get_input_directory()) / MEDIA_SUBFOLDER
    directory.mkdir(parents=True, exist_ok=True)
    stem = os.path.splitext(os.path.basename(file))[0]
    span = f"{start:.2f}-{end:.2f}" if end is not None else f"{start:.2f}-end"
    out_path = unique_path(directory, safe_name(f"{stem}_{span}.flac"))
    write_flac(samples, rate, out_path)
    logger.info(f"MediaLoader : audio of [{file}] {span}s saved as [{out_path.name}] ({samples.shape[1] / rate:.2f}s, {rate}Hz, {samples.shape[0]}ch)")
    return {"name": out_path.name, "file": f"{MEDIA_SUBFOLDER}/{out_path.name}", "type": "input",
            "duration": samples.shape[1] / rate, "sample_rate": rate, "channels": int(samples.shape[0])}

from aiohttp import web
from server import PromptServer

@PromptServer.instance.routes.post(f"/{API_PREFIX}/media_loader/extract_audio")
async def extract_audio_route(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "expected a JSON body"}, status=400)
    file = str(data.get("file") or "")
    file_type = str(data.get("type") or "input")
    if not file or "\\" in file or ".." in file.split("/"):
        return web.json_response({"error": "invalid file"}, status=400)
    try:
        start = max(0.0, float(data.get("start") or 0))
        end = data.get("end")
        end = None if end is None else float(end)
    except (TypeError, ValueError):
        return web.json_response({"error": "invalid span"}, status=400)
    if end is not None and end <= start:
        return web.json_response({"error": "invalid span"}, status=400)
    try:
        result = await asyncio.get_running_loop().run_in_executor(None, extract_audio, file, file_type, start, end)
    except (FileNotFoundError, ValueError) as e:
        return web.json_response({"error": str(e)}, status=400)
    except Exception as e:
        logger.warning(f"MediaLoader : audio extraction failed : {e}")
        return web.json_response({"error": f"extraction failed : {e}"}, status=500)
    return web.json_response(result)
