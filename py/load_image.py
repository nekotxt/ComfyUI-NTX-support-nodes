from comfy_api.latest import io

import folder_paths
import nodes
import torch

import asyncio
import hashlib
import json
import os
import threading

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX
from .logging import logger
# the picture edits of the Load Image & Edit node are the ones of the Media Loader's picture slots,
# recorded by the same editor (web/js/media_loader.editor.js) and applied by the same pipeline
from .media_loader import MEDIA_SUBFOLDER, apply_frame_edits, is_edited, normalize_edit

# ===== Image loading utilities ================================================================================================================

# the list the image combo is filled with : every image file sitting in the ComfyUI input
# directory, exactly as the core Load Image node lists them
def load_list_input_images() -> list[str]:
    input_dir = folder_paths.get_input_directory()
    files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
    return sorted(folder_paths.filter_files_content_types(files, ["image"]))

# crop an image batch [B, H, W, C] and its mask [B, H, W] to the rectangle (x, y, width, height),
# expressed in pixels of the image. The rectangle is clamped to the image, and an empty one
# (zero width or height) means "no crop" : the image and the mask are returned untouched.
def crop_image_and_mask(image, mask, x: int, y: int, width: int, height: int):
    image_height = image.shape[1]
    image_width = image.shape[2]

    x = max(0, min(int(x), image_width))
    y = max(0, min(int(y), image_height))
    width = max(0, min(int(width), image_width - x))
    height = max(0, min(int(height), image_height - y))
    if width <= 0 or height <= 0:
        return image, mask

    cropped_image = image[:, y:y + height, x:x + width, :]

    # the mask only follows the crop when it actually covers the image : the loader hands back a
    # placeholder 64x64 mask for images without an alpha channel, and cropping that one would be
    # meaningless, so an empty mask of the cropped size is returned instead
    if mask.shape[1] == image_height and mask.shape[2] == image_width:
        cropped_mask = mask[:, y:y + height, x:x + width]
    else:
        cropped_mask = torch.zeros((mask.shape[0], height, width), dtype=mask.dtype, device=mask.device)

    return cropped_image, cropped_mask

# the edit record the Load Image & Edit node keeps in its hidden edit_settings widget : the same
# record the Media Loader stores on a picture slot (rotate, mirror, crop, max size - see
# media_loader.normalize_edit for the pipeline it describes), as the JSON the editor wrote
def parse_edit_settings(edit_settings: str) -> dict:
    try:
        record = json.loads(edit_settings or "{}")
    except (TypeError, ValueError):
        logger.warning(f"LoadImageAndEdit : unreadable edit settings, the picture is left untouched")
        record = {}
    return normalize_edit(record)

# an edit record in words, for the log (the frontend twin is describeEdit of media_loader.editor.js)
def describe_edit(edit: dict) -> str:
    parts = []
    if edit["rotate"]:
        parts.append(f"rotated {edit['rotate']}°")
    if edit["mirror_h"]:
        parts.append("mirrored horizontally")
    if edit["mirror_v"]:
        parts.append("mirrored vertically")
    if edit["crop"]:
        parts.append(f"cropped to {edit['crop']['width']}x{edit['crop']['height']}")
    if edit["max_size"]:
        parts.append(f"max {edit['max_size']}px")
    return ", ".join(parts)

# apply an edit record to a loaded image [B, H, W, C] and its mask [B, H, W]
def apply_image_edits(image, mask, edit: dict):
    edited_image = apply_frame_edits(image, edit)

    # the mask only follows the edits when it actually covers the image : the loader hands back a
    # placeholder 64x64 mask for images without an alpha channel, and editing that one would be
    # meaningless, so an empty mask of the edited size is returned instead
    if mask.shape[1] == image.shape[1] and mask.shape[2] == image.shape[2]:
        # the mask goes through as three channels rather than one : comfy.utils.lanczos, which the
        # max size step resamples with, treats a one channel batch as greyscale and hands it back
        # without its channel axis, which would come out of apply_frame_edits transposed. Three
        # channels also means the mask is resampled exactly like the image it belongs to.
        edited_mask = apply_frame_edits(mask.unsqueeze(-1).repeat(1, 1, 1, 3), edit)[..., 0]
    else:
        edited_mask = torch.zeros((mask.shape[0], edited_image.shape[1], edited_image.shape[2]),
                                  dtype=mask.dtype, device=mask.device)

    return edited_image, edited_mask.contiguous()

# ===== NODES ==================================================================================================================================

class LoadImageAndCrop(io.ComfyNode):
    """Load Image with a crop rectangle drawn on the preview.

    The decoding itself is delegated to the core Load Image node, so this node behaves exactly like
    it : same file list, same upload button, same mask painting (the mask editor writes its result
    back into the "image" widget), same image / mask outputs.

    What it adds is a crop rectangle, edited by dragging on the image preview - see the frontend
    half in web/js/load_image.crop.js. The rectangle lives in the crop_x / crop_y / crop_width /
    crop_height widgets, in pixels of the loaded image; they are hidden on the node because the
    preview is what edits them, but they still serialize with the workflow and reach this node like
    any other widget. A zero width or height means "no crop".
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadImageAndCrop",
            display_name=f"{ADDON_PREFIX} Load Image & Crop",
            description="Load an image from the input directory, like the core Load Image node "
                        "(mask painting included), with an optional crop rectangle drawn on the preview.",
            category=f"{ADDON_CATEGORY}/deprecated/images",
            inputs=[
                io.Combo.Input(
                    "image",
                    options=load_list_input_images(),
                    upload=io.UploadType.image,
                    image_folder=io.FolderType.input,
                    tooltip="The image to load. Right click the node and pick 'Open in Mask Editor' to paint a mask.",
                ),
                # the crop rectangle : hidden and socketless, it is drawn and edited on the preview
                io.Int.Input("crop_x", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_y", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_width", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_height", default=0, min=0, max=nodes.MAX_RESOLUTION,
                             socketless=True, extra_dict={"hidden": True}),
            ],
            outputs=[
                io.Image.Output("image"),
                io.Mask.Output("mask"),
            ],
        )

    @classmethod
    def execute(cls, image, crop_x, crop_y, crop_width, crop_height) -> io.NodeOutput:
        logger.node_name("LoadImageAndCrop")

        # the core node does the decoding : animated formats, exif orientation, alpha -> mask,
        # and the clipspace files the mask editor produces
        loaded_image, loaded_mask = nodes.LoadImage().load_image(image)

        cropped_image, cropped_mask = crop_image_and_mask(loaded_image, loaded_mask,
                                                          crop_x, crop_y, crop_width, crop_height)

        if cropped_image is loaded_image:
            logger.info(f"loaded [{image}] ({loaded_image.shape[2]}x{loaded_image.shape[1]}), no crop")
        else:
            logger.info(f"loaded [{image}] ({loaded_image.shape[2]}x{loaded_image.shape[1]}), "
                        f"cropped to {cropped_image.shape[2]}x{cropped_image.shape[1]} at ({crop_x},{crop_y})")

        return io.NodeOutput(cropped_image, cropped_mask)

    @classmethod
    def fingerprint_inputs(cls, image, crop_x, crop_y, crop_width, crop_height):
        # the widget values are part of the cache key already ; what the executor cannot see is the
        # content of the file behind the name, which the mask editor rewrites in place
        image_path = folder_paths.get_annotated_filepath(image)
        digest = hashlib.sha256()
        with open(image_path, "rb") as file:
            digest.update(file.read())
        return digest.hexdigest()

    @classmethod
    def validate_inputs(cls, image):
        # naming "image" here also tells the executor to skip its own combo check on it, so freshly
        # uploaded files and the mask editor's clipspace/... paths are accepted
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True

class LoadImageAndEdit(io.ComfyNode):
    """Load Image with a picture editor on the preview, and a fast path for pasted images.

    The loading half is the core Load Image node - same file list, same upload button, same mask
    painting, same image / mask outputs, and the decoding is delegated to the core node.

    What it adds is an **editor**, opened by the pencil icon drawn over the image preview: the very
    editor the picture slots of the Media Loader use, recording the same rotate / mirror / crop /
    max size record (see media_loader.normalize_edit). The record lives in the hidden edit_settings
    widget, so it serializes with the workflow and reaches this node like any other widget. The
    file on disk is never touched: the frontend only redraws the preview through the edited record
    (see web/js/load_image.edit.js), and the edits are applied here, at execution, to the image
    *and* to its mask, so a painted mask follows the picture it was painted on.

    The mask editor is deliberately left untouched - it is the core one, and it still works on the
    **original** picture, because the edited version only ever exists as something drawn on the
    preview, never as the node's `imgs`.

    What it also changes is invisible until an image is *pasted* on it (Ctrl+V with the node
    selected), which the frontend redirects to this module's own upload route instead of the core
    /upload/image one. Both routes do the same thing - write the image into input/pasted, reusing
    an existing file when the same bytes are already there - but the core one rediscovers that by
    re-reading and re-hashing every "image (N).png" of the folder on every single paste, which
    grows into several seconds once the folder holds a few hundred files. This one keeps the hashes
    in a register file next to the images, so each file is hashed once (see store_pasted_image).

    Dragging a file onto the node and the "choose file to upload" button are left strictly alone :
    they keep the core handlers, hence the core behaviour, destination folder included.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadImageAndEdit",
            display_name=f"{ADDON_PREFIX} Load Image & Edit",
            description="Load an image from the input directory, like the core Load Image node "
                        "(mask painting included), with a picture editor on the preview (rotate, mirror, "
                        "crop, max size) and pasted images uploaded through a hash register so pasting "
                        "stays fast however many images the input/pasted folder holds.",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                io.Combo.Input(
                    "image",
                    options=load_list_input_images(),
                    upload=io.UploadType.image,
                    image_folder=io.FolderType.input,
                    tooltip="The image to load. Paste one with Ctrl+V, drop a file on the node, or use the "
                            "upload button. Right click the node and pick 'Open in Mask Editor' to paint a mask.",
                ),
                # the edit record : hidden and socketless, it is written by the editor the pencil
                # icon on the preview opens, and holds the JSON of a Media Loader picture edit
                io.String.Input("edit_settings", default="", socketless=True,
                                extra_dict={"hidden": True}),
            ],
            outputs=[
                io.Image.Output("image"),
                io.Mask.Output("mask"),
            ],
        )

    @classmethod
    def execute(cls, image, edit_settings) -> io.NodeOutput:
        logger.node_name("LoadImageAndEdit")

        # the core node does the decoding : animated formats, exif orientation, alpha -> mask,
        # and the clipspace files the mask editor produces
        loaded_image, loaded_mask = nodes.LoadImage().load_image(image)
        size = f"{loaded_image.shape[2]}x{loaded_image.shape[1]}"

        edit = parse_edit_settings(edit_settings)
        if not is_edited(edit):
            logger.info(f"loaded [{image}] ({size}), no edit")
            return io.NodeOutput(loaded_image, loaded_mask)

        edited_image, edited_mask = apply_image_edits(loaded_image, loaded_mask, edit)
        logger.info(f"loaded [{image}] ({size}), edited to "
                    f"{edited_image.shape[2]}x{edited_image.shape[1]} ({describe_edit(edit)})")

        return io.NodeOutput(edited_image, edited_mask)

    @classmethod
    def fingerprint_inputs(cls, image, edit_settings):
        # the widget values are part of the cache key already ; what the executor cannot see is the
        # content of the file behind the name, which the mask editor rewrites in place
        image_path = folder_paths.get_annotated_filepath(image)
        digest = hashlib.sha256()
        with open(image_path, "rb") as file:
            digest.update(file.read())
        return digest.hexdigest()

    @classmethod
    def validate_inputs(cls, image):
        # naming "image" here also tells the executor to skip its own combo check on it, so freshly
        # uploaded files and the pasted/... and clipspace/... paths are accepted
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True

# ===== INITIALIZATION =========================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        LoadImageAndCrop,
        LoadImageAndEdit,
    ]

# ===== Pasted images register =================================================================================================================

# Where the frontend's paste handler ends up (see web/js/load_image.edit.js).
#
# The core /upload/image route writes pasted images into input/pasted under the "image.png",
# "image (1).png", "image (2).png" ... series, and before taking a name it compares the bytes
# being uploaded with the bytes of every file already in that series, so the same image pasted
# twice is stored once. The comparison re-reads and re-hashes those files on *every* paste, which
# is fine for a handful of them and turns into seconds once the folder holds hundreds.
#
# This module does the same, but keeps the hashes in a register file sitting next to the images.
# A file is hashed the first time it is seen and never again, unless its size or its modification
# time moved - so a paste costs one hash of the incoming image plus a directory listing, whatever
# the folder holds. The register is a plain text file, one line per image :
#
#     <sha256>  <size in bytes>  <mtime in ns>  <file name>        (tab separated)
#
# The name comes last so it can hold anything but a newline, and the file can be deleted at any
# time : it is rebuilt from the folder on the next paste.

PASTED_SUBFOLDER = "pasted"            # subfolder of the input directory, the core route's own
# the subfolders of the input directory a paste may be stored in : the one the core route uses, and
# the Media Loader's own, whose picture slots paste through this route too. The client names one of
# them, so the list is what keeps a request from steering a write anywhere else.
PASTED_SUBFOLDERS = (PASTED_SUBFOLDER, MEDIA_SUBFOLDER)
PASTED_REGISTER = "_ntx_pasted_hashes.txt"
PASTED_DEFAULT_STEM = "image"          # what a pasted image is named when the browser gives no name
PASTED_DEFAULT_EXT = ".png"
PASTED_SEED_NOTICE = 20                # hashing more files than this at once is worth a log line

# the register is read, updated and rewritten as a whole, and uploads are served from a thread
# pool, so one paste at a time gets to touch it
_register_lock = threading.Lock()

def _hash_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()

# the stem and extension a pasted file is stored under : whatever the client sent, reduced to a
# plain file name that cannot climb out of the pasted folder
def _safe_stem(filename: str) -> tuple[str, str]:
    name = str(filename or "").replace("\\", "/").split("/")[-1].strip()
    stem, ext = os.path.splitext(name)
    stem = "".join(c for c in stem if c.isalnum() or c in " _-.").strip(" .")
    ext = "".join(c for c in ext if c.isalnum() or c == ".")
    if not stem:
        stem = PASTED_DEFAULT_STEM
    if len(ext) < 2 or not ext.startswith("."):
        ext = PASTED_DEFAULT_EXT
    return stem, ext

# name -> (sha256, size, mtime_ns), an unreadable or damaged register reading as empty so the next
# write rebuilds it from the folder
def _read_register(path: str) -> dict[str, tuple[str, int, int]]:
    entries: dict[str, tuple[str, int, int]] = {}
    try:
        with open(path, "r", encoding="utf-8") as file:
            for line in file:
                line = line.rstrip("\n")
                if not line or line.startswith("#"):
                    continue
                parts = line.split("\t", 3)
                if len(parts) != 4:
                    continue
                digest, size, mtime, name = parts
                try:
                    entries[name] = (digest, int(size), int(mtime))
                except ValueError:
                    continue
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning(f"LoadImageAndEdit : could not read [{path}] : {e}")
    return entries

def _write_register(folder: str, entries: dict[str, tuple[str, int, int]]) -> None:
    path = os.path.join(folder, PASTED_REGISTER)
    temp = path + ".tmp"
    try:
        with open(temp, "w", encoding="utf-8", newline="\n") as file:
            file.write(f"# {ADDON_PREFIX} Load Image & Edit : sha256 of every image of this folder, as\n"
                       f"# <sha256> <size> <mtime_ns> <name>, tab separated.\n"
                       f"# Deleting this file is harmless : it is rebuilt on the next paste.\n")
            for name, (digest, size, mtime) in sorted(entries.items()):
                file.write(f"{digest}\t{size}\t{mtime}\t{name}\n")
        os.replace(temp, path)
    except OSError as e:
        logger.warning(f"LoadImageAndEdit : could not write [{path}] : {e}")

# bring the register in line with what the folder actually holds, hashing only the files it does
# not cover yet, and return the up to date name -> (sha256, size, mtime_ns) mapping
def _sync_register(folder: str) -> dict[str, tuple[str, int, int]]:
    known = _read_register(os.path.join(folder, PASTED_REGISTER))

    live: dict[str, tuple[str, int, int]] = {}
    try:
        with os.scandir(folder) as scan:
            for entry in scan:
                # the register itself, and the temporary file a crashed write may have left behind
                if entry.name.startswith(PASTED_REGISTER) or not entry.is_file():
                    continue
                try:
                    stat = entry.stat()
                except OSError:
                    continue
                live[entry.name] = (entry.path, stat.st_size, stat.st_mtime_ns)
    except OSError as e:
        logger.warning(f"LoadImageAndEdit : could not list [{folder}] : {e}")
        return known

    # a file the register already covers is trusted as long as its size and its modification time
    # are still the ones that were hashed ; anything else is (re)hashed
    def is_known(name: str) -> bool:
        previous = known.get(name)
        _, size, mtime = live[name]
        return previous is not None and previous[1] == size and previous[2] == mtime

    pending = [name for name in live if not is_known(name)]
    if len(pending) > PASTED_SEED_NOTICE:
        logger.info(f"LoadImageAndEdit : hashing {len(pending)} images of {os.path.basename(folder)}/ into "
                    f"[{PASTED_REGISTER}] - a file is hashed once, so this is paid only the first time")

    entries: dict[str, tuple[str, int, int]] = {}
    for name, (path, size, mtime) in live.items():
        if is_known(name):
            entries[name] = known[name]
            continue
        try:
            entries[name] = (_hash_file(path), size, mtime)
        except OSError as e:
            logger.warning(f"LoadImageAndEdit : could not hash [{path}] : {e}")

    # the register is only rewritten when it no longer describes the folder, so a paste that finds
    # everything in place does not touch it
    if entries != known:
        _write_register(folder, entries)
    return entries

# store one pasted image in a subfolder of the input directory, reusing an existing file when the
# same bytes are already there, and return the {name, subfolder, type} the frontend needs to fill
# the widget or the slot it came from. Each subfolder carries its own register.
def store_pasted_image(data: bytes, filename: str, subfolder: str = PASTED_SUBFOLDER) -> dict:
    if subfolder not in PASTED_SUBFOLDERS:
        raise ValueError(f"unexpected subfolder [{subfolder}]")

    folder = os.path.join(folder_paths.get_input_directory(), subfolder)
    os.makedirs(folder, exist_ok=True)
    stem, ext = _safe_stem(filename)
    digest = hashlib.sha256(data).hexdigest()

    with _register_lock:
        entries = _sync_register(folder)

        # same bytes already in the folder : reuse that file, like the core route does. The lookup
        # is by content, so an identical image is found whatever name it was stored under.
        for name in sorted(entries):
            if entries[name][0] == digest:
                logger.info(f"LoadImageAndEdit : pasted image already stored as [{subfolder}/{name}]")
                return {"name": name, "subfolder": subfolder, "type": "input", "duplicate": True}

        # otherwise the first free name of the "image.png", "image (1).png", ... series
        index = 0
        while True:
            name = f"{stem}{ext}" if index == 0 else f"{stem} ({index}){ext}"
            path = os.path.join(folder, name)
            if name not in entries and not os.path.exists(path):
                break
            index += 1

        with open(path, "wb") as file:
            file.write(data)
        stat = os.stat(path)
        entries[name] = (digest, stat.st_size, stat.st_mtime_ns)
        _write_register(folder, entries)

    logger.info(f"LoadImageAndEdit : pasted image saved as [{subfolder}/{name}]")
    return {"name": name, "subfolder": subfolder, "type": "input", "duplicate": False}

# ===== JAVASCRIPT API =========================================================================================================================

from aiohttp import web
from server import PromptServer

# The paste handler of the Load Image & Edit node and of the Media Loader's picture slots : same
# contract as the core /upload/image route (a multipart body carrying an "image" file, a
# {name, subfolder, type} answer), with the destination named by the optional "subfolder" field -
# one of PASTED_SUBFOLDERS, input/pasted when it is left out.
@PromptServer.instance.routes.post(f"/{API_PREFIX}/load_image/upload_pasted")
async def upload_pasted_image_route(request):
    try:
        post = await request.post()
    except Exception:
        return web.json_response({"error": "expected a multipart body"}, status=400)
    image = post.get("image")
    if image is None or not hasattr(image, "file"):
        return web.json_response({"error": "missing image"}, status=400)
    data = image.file.read()
    if not data:
        return web.json_response({"error": "empty image"}, status=400)
    filename = getattr(image, "filename", "") or PASTED_DEFAULT_STEM + PASTED_DEFAULT_EXT
    subfolder = str(post.get("subfolder") or PASTED_SUBFOLDER)
    if subfolder not in PASTED_SUBFOLDERS:
        return web.json_response({"error": f"unexpected subfolder [{subfolder}]"}, status=400)
    try:
        result = await asyncio.get_running_loop().run_in_executor(
            None, store_pasted_image, data, filename, subfolder)
    except Exception as e:
        logger.warning(f"LoadImageAndEdit : pasted upload failed : {e}")
        return web.json_response({"error": f"upload failed : {e}"}, status=500)
    return web.json_response(result)
