from comfy_api.latest import ComfyExtension, io, ui, InputImpl, Types
from comfy_extras.nodes_video import _save_video_codec_input
from comfy_extras.nodes_audio import load as load_audio_file

import av
import folder_paths
import torch
from comfy.cli_args import args

import json
import shutil
import time
from datetime import datetime
from fractions import Fraction
from pathlib import Path

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger
from .utils import notify_user
from PIL import Image

from .images import COMFY_FOLDERS, get_comfy_folder, resolve_path, tensor_to_pillow, pillow_to_tensor

# ===== Video utilities ========================================================================================================================

# extensions tried, in order, when a video path is given without one
VIDEO_EXTENSIONS = ["mp4", "mkv", "webm"]

# locate a saved file inside one of the ComfyUI folders, so that the frontend can preview it
# (None when the file lives elsewhere)
def saved_result_for(file_path: Path) -> ui.SavedResult | None:
    for folder in COMFY_FOLDERS:
        base = Path(get_comfy_folder(folder)).resolve()
        try:
            relative = file_path.relative_to(base)
        except ValueError:
            continue
        subfolder = "" if relative.parent == Path(".") else relative.parent.as_posix()
        return ui.SavedResult(relative.name, subfolder, io.FolderType(folder))
    return None

# layout of a lossless video directory (see SaveLosslessVideoToPath)
LOSSLESS_INFO_FILE = "info.json"
LOSSLESS_AUDIO_FILE = "audio.flac"
LOSSLESS_FRAME_PATTERN = "frame_{:05}.png"
LOSSLESS_MARKER = "ntx_lossless_video"
LOSSLESS_ROOT_DIR = "lossless_video_save"     # every lossless directory lives under <folder>/lossless_video_save

# resolve a lossless video directory: the path must be relative, without dots, and stay inside
# <folder>/lossless_video_save; the reason is returned alongside when it is refused
def resolve_lossless_dir(folder: str, path: str) -> tuple[Path | None, str | None]:
    if path is None or not path.strip():
        return None, "path is empty"
    if Path(path.strip()).is_absolute():
        return None, f"absolute paths are not allowed : {path}"
    if "." in path:
        return None, f"paths containing dots are not allowed : {path}"
    root_dir = (Path(get_comfy_folder(folder)) / LOSSLESS_ROOT_DIR).resolve()
    dir_path = resolve_path(path, root_dir).resolve()
    if dir_path == root_dir or root_dir not in dir_path.parents:
        return None, f"path must stay inside {LOSSLESS_ROOT_DIR} : {path}"
    return dir_path, None

# read the info file of a lossless video directory (None when absent or not written by the save node)
def read_lossless_info(dir_path: Path) -> dict | None:
    info_file = dir_path / LOSSLESS_INFO_FILE
    if not info_file.is_file():
        return None
    try:
        info = json.loads(info_file.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(info, dict) or not info.get(LOSSLESS_MARKER):
        return None
    return info

# write the first waveform of an AUDIO batch as a FLAC file
def save_audio_flac(audio: dict, file_path: Path) -> dict:
    waveform = audio["waveform"][0].float().cpu()    # [C, T]
    sample_rate = int(audio["sample_rate"])
    layout = {1: "mono", 2: "stereo", 6: "5.1"}.get(waveform.shape[0], "stereo")
    with av.open(str(file_path), mode="w", format="flac") as container:
        stream = container.add_stream("flac", rate=sample_rate, layout=layout)
        frame = av.AudioFrame.from_ndarray(waveform.movedim(0, 1).reshape(1, -1).contiguous().numpy(), format="flt", layout=layout)
        frame.sample_rate = sample_rate
        frame.pts = 0
        container.mux(stream.encode(frame))
        container.mux(stream.encode(None))
    return {"file": file_path.name, "sample_rate": sample_rate, "channels": int(waveform.shape[0]), "samples": int(waveform.shape[1])}

# ===== NODES : VIDEO ==========================================================================================================================

class SaveVideoToPath(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SaveVideoToPath",
            display_name=f"{ADDON_PREFIX} Save Video To Path",
            description="Save the frames (and audio) as a video exactly at the given path, no progressive counter. The extension follows the selected format. A relative path is resolved against the selected ComfyUI folder.",
            category=f"{ADDON_CATEGORY}/video",
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio", optional=True),
                io.Float.Input("fps", default=30.0, min=1.0, max=120.0, step=1.0),
                io.Combo.Input("folder", options=COMFY_FOLDERS, default="output", tooltip="ComfyUI folder a relative path is resolved against (ignored when path is absolute)"),
                io.String.Input("path", multiline=False, dynamic_prompts=False, default=""),
                # same container / codec selectors as the native Save Video node
                io.DynamicCombo.Input(
                    "format",
                    options=[
                        io.DynamicCombo.Option("auto", [_save_video_codec_input(["auto", "h264", "av1"])]),
                        io.DynamicCombo.Option("mp4", [_save_video_codec_input(["auto", "h264", "av1"])]),
                        io.DynamicCombo.Option("mkv", [_save_video_codec_input(["auto", "h264", "av1"])]),
                        io.DynamicCombo.Option("webm", [_save_video_codec_input(["auto", "av1"])]),
                    ],
                    tooltip="The output container. Auto uses MP4 for Auto/H.264 and WebM for AV1. MP4, MKV, and WebM select a specific container.",
                ),
                io.Boolean.Input("overwrite", default=True, label_on="yes", label_off="no"),
            ],
            outputs=[
                io.String.Output("saved_path", tooltip="Full absolute path of the saved file"),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images, fps: float, folder: str, path: str, format, overwrite: bool, audio=None):

        logger.node_name("SaveVideoToPath")

        # unpack the container / codec selection as the native Save Video node does
        if isinstance(format, dict):
            format_name = format["format"]
            codec = format.get("codec") or {"codec": "auto"}
        else:
            format_name = format
            codec = {"codec": "auto"}
        codec_name = codec["codec"]
        if format_name == "auto":
            format_name = "webm" if codec_name == "av1" else "mp4"
        encoding = codec.get("encoding") or {}

        # resolve the target file: the extension follows the container
        extension = Types.VideoContainer.get_extension(format_name)
        file_path = resolve_path(path, get_comfy_folder(folder)).with_suffix(f".{extension}").resolve()
        saved_path = str(file_path)

        if file_path.exists() and not overwrite:
            msg = f"file already exists, save skipped : {file_path}"
            logger.warning(msg)
            notify_user("warn", "Save Video To Path", msg)
            return io.NodeOutput(saved_path)

        # embed prompt and workflow as the native Save Video node does
        metadata = None
        if not args.disable_metadata:
            metadata = {}
            if cls.hidden.extra_pnginfo is not None:
                metadata.update(cls.hidden.extra_pnginfo)
            if cls.hidden.prompt is not None:
                metadata["prompt"] = cls.hidden.prompt
            if len(metadata) == 0:
                metadata = None

        file_path.parent.mkdir(parents=True, exist_ok=True)
        video = InputImpl.VideoFromComponents(Types.VideoComponents(images=images, audio=audio, frame_rate=Fraction(fps)))
        video.save_to(
            saved_path,
            format=Types.VideoContainer(format_name),
            codec=Types.VideoCodec(codec_name),
            metadata=metadata,
            crf=encoding.get("crf"),
        )
        logger.info(f"Saved file : {file_path} ({images.shape[0]} frames @ {fps} fps, {format_name}/{codec_name})")

        result = saved_result_for(file_path)
        if result is not None:
            return io.NodeOutput(saved_path, ui=ui.PreviewVideo([result]))
        return io.NodeOutput(saved_path)

class SaveLosslessVideoToPath(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SaveLosslessVideoToPath",
            display_name=f"{ADDON_PREFIX} Save Lossless Video To Path",
            description="Save the frames as PNG files, the audio as FLAC and the frame rate as JSON inside the directory given by path (no compression loss). The path must be relative: it is resolved against <folder>/lossless_video_save.",
            category=f"{ADDON_CATEGORY}/video",
            is_output_node=True,
            inputs=[
                io.Image.Input("images"),
                io.Audio.Input("audio", optional=True),
                io.Float.Input("fps", default=30.0, min=1.0, max=120.0, step=1.0),
                io.Combo.Input("folder", options=COMFY_FOLDERS, default="output", tooltip="ComfyUI folder the path is resolved against"),
                io.String.Input("path", multiline=False, dynamic_prompts=False, default="", tooltip="Directory receiving the frames, the audio and the info file, relative to <folder>/lossless_video_save (absolute paths and paths containing dots are refused)"),
                io.Boolean.Input("overwrite", default=True, label_on="yes", label_off="no", tooltip="yes: an existing directory is emptied first. no: the save is skipped when the directory exists"),
            ],
            outputs=[
                io.String.Output("saved_path", tooltip="Full absolute path of the directory (empty when the save was refused)"),
            ],
        )

    @classmethod
    def execute(cls, images, fps: float, folder: str, path: str, overwrite: bool, audio=None):

        logger.node_name("SaveLosslessVideoToPath")

        # the directory is always confined under <folder>/lossless_video_save: absolute paths, paths
        # containing dots (so any ./ or ../ segment) and relative ones climbing out of it are refused
        dir_path, reason = resolve_lossless_dir(folder, path)
        if dir_path is None:
            msg = f"{reason}, save refused"
            logger.warning(msg)
            notify_user("warn", "Save Lossless Video To Path", msg)
            return io.NodeOutput("")
        saved_path = str(dir_path)

        if dir_path.exists():
            if not dir_path.is_dir():
                raise ValueError(f"path exists and is not a directory : {dir_path}")
            if not overwrite:
                msg = f"directory already exists, save skipped : {dir_path}"
                logger.warning(msg)
                notify_user("warn", "Save Lossless Video To Path", msg)
                return io.NodeOutput(saved_path)
            # only a directory this node wrote (or an empty one) is emptied: anything else is left alone
            entries = list(dir_path.iterdir())
            if entries:
                if read_lossless_info(dir_path) is None:
                    raise ValueError(f"refusing to empty a directory not written by this node : {dir_path}")
                for entry in entries:
                    if entry.is_dir() and not entry.is_symlink():
                        shutil.rmtree(entry)
                    else:
                        entry.unlink()
                logger.info(f"Emptied directory : {dir_path}")
        else:
            dir_path.mkdir(parents=True, exist_ok=True)

        # frames: plain PNG files, no metadata
        for (index, image) in enumerate(images):
            tensor_to_pillow(image).save(dir_path / LOSSLESS_FRAME_PATTERN.format(index + 1), compress_level=4)

        # audio: FLAC
        audio_info = None
        if audio is not None:
            audio_info = save_audio_flac(audio, dir_path / LOSSLESS_AUDIO_FILE)

        # frame rate, layout and timestamp
        now = time.time_ns()
        info = {
            LOSSLESS_MARKER: True,
            "fps": float(fps),
            "frame_count": int(images.shape[0]),
            "width": int(images.shape[2]),
            "height": int(images.shape[1]),
            "frame_pattern": LOSSLESS_FRAME_PATTERN,
            "audio": audio_info,
            "timestamp": datetime.fromtimestamp(now / 1e9).isoformat(timespec="milliseconds"),
            "timestamp_ns": now,
        }
        (dir_path / LOSSLESS_INFO_FILE).write_text(json.dumps(info, indent=4), encoding="utf-8")

        logger.info(f"Saved directory : {dir_path} ({info['frame_count']} frames @ {fps} fps, audio: {'yes' if audio_info else 'no'})")

        return io.NodeOutput(saved_path, ui=ui.PreviewImage(images[0:1], cls=cls))

class LoadVideoFromPath(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadVideoFromPath",
            display_name=f"{ADDON_PREFIX} Load Video From Path",
            description="Load a video from the given path and return its frames, audio and frame rate (.mp4, .mkv and .webm are tried in this order when no extension is given). A relative path is resolved against the selected ComfyUI folder. The node runs again only when the path or the file on disk (size / modification time) changes.",
            category=f"{ADDON_CATEGORY}/video",
            inputs=[
                io.Combo.Input("folder", options=COMFY_FOLDERS, default="input", tooltip="ComfyUI folder a relative path is resolved against (ignored when path is absolute)"),
                io.String.Input("path", multiline=False, dynamic_prompts=False, default=""),
                io.Boolean.Input("suppress_errors", default=True, label_on="yes", label_off="no", tooltip="When the file is not found the node outputs None; turn this off to also get a toast warning"),
            ],
            outputs=[
                io.Image.Output("images"),
                io.Audio.Output("audio"),
                io.Float.Output("fps"),
                io.Boolean.Output("loaded", tooltip="True when the file was loaded, False when it was not found"),
            ],
        )

    # resolve the source file: a path without extension tries VIDEO_EXTENSIONS in order and
    # returns the first that exists (or the first candidate, for error reporting, when none does);
    # an empty path yields None
    @classmethod
    def resolve_file(cls, folder: str, path: str) -> Path | None:
        if path is None or not path.strip():
            return None
        file_path = resolve_path(path, get_comfy_folder(folder))
        if file_path.suffix:
            return file_path
        candidates = [file_path.with_suffix(f".{ext}") for ext in VIDEO_EXTENSIONS]
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        return candidates[0]

    # the cache key of the node includes this value, so the node is re-executed only when the
    # resolved path or the file on disk (size / modification time) differs from the last run
    # (a missing file gets its own stable marker, so the node re-runs as soon as the file appears)
    @classmethod
    def fingerprint_inputs(cls, folder: str, path: str, suppress_errors: bool):
        try:
            file_path = cls.resolve_file(folder, path)
            if file_path is None or not file_path.is_file():
                return f"{file_path}|missing|{suppress_errors}"
            stat = file_path.stat()
            return f"{file_path}|{stat.st_size}|{stat.st_mtime_ns}"
        except Exception:
            return float("NaN")     # unreadable path : always re-run so the problem surfaces at execution

    @classmethod
    def execute(cls, folder: str, path: str, suppress_errors: bool):

        logger.node_name("LoadVideoFromPath")

        file_path = cls.resolve_file(folder, path)

        if file_path is None or not file_path.is_file():
            msg = f"File not found: {file_path if file_path is not None else path}"
            logger.warning(msg)
            if not suppress_errors:
                notify_user("warn", "Load Video From Path", msg)
            return io.NodeOutput(None, None, None, False)

        components = InputImpl.VideoFromFile(str(file_path)).get_components()
        fps = float(components.frame_rate)

        logger.info(f"Loaded file : {file_path} ({components.images.shape[0]} frames @ {fps} fps, audio: {'yes' if components.audio is not None else 'no'})")

        return io.NodeOutput(components.images, components.audio, fps, True)

class LoadLosslessVideoFromPath(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadLosslessVideoFromPath",
            display_name=f"{ADDON_PREFIX} Load Lossless Video From Path",
            description="Load the frames, audio and frame rate written by Save Lossless Video To Path from the directory given by path, relative to <folder>/lossless_video_save. The node runs again only when the directory content changes (its save timestamp differs).",
            category=f"{ADDON_CATEGORY}/video",
            inputs=[
                io.Combo.Input("folder", options=COMFY_FOLDERS, default="output", tooltip="ComfyUI folder the path is resolved against"),
                io.String.Input("path", multiline=False, dynamic_prompts=False, default="", tooltip="Directory written by Save Lossless Video To Path, relative to <folder>/lossless_video_save (absolute paths and paths containing dots are refused)"),
                io.Boolean.Input("suppress_errors", default=True, label_on="yes", label_off="no", tooltip="When the directory is not found the node outputs None; turn this off to also get a toast warning"),
            ],
            outputs=[
                io.Image.Output("images"),
                io.Audio.Output("audio"),
                io.Float.Output("fps"),
                io.Boolean.Output("loaded", tooltip="True when the directory was loaded, False when it was not found"),
            ],
        )

    # the cache key of the node includes this value, so the node is re-executed only when the
    # resolved directory or the timestamp written by the save node differs from the last run
    # (a missing directory gets its own stable marker, so the node re-runs as soon as it appears)
    @classmethod
    def fingerprint_inputs(cls, folder: str, path: str, suppress_errors: bool):
        try:
            dir_path, reason = resolve_lossless_dir(folder, path)
            info = read_lossless_info(dir_path) if dir_path is not None else None
            if info is None:
                return f"{dir_path}|missing|{suppress_errors}"
            return f"{dir_path}|{info.get('timestamp_ns')}|{info.get('frame_count')}"
        except Exception:
            return float("NaN")     # unreadable path : always re-run so the problem surfaces at execution

    @classmethod
    def execute(cls, folder: str, path: str, suppress_errors: bool):

        logger.node_name("LoadLosslessVideoFromPath")

        dir_path, reason = resolve_lossless_dir(folder, path)
        info = read_lossless_info(dir_path) if dir_path is not None else None

        if info is None:
            msg = f"Directory not found: {dir_path}" if dir_path is not None else f"Invalid path ({reason})"
            logger.warning(msg)
            if not suppress_errors:
                notify_user("warn", "Load Lossless Video From Path", msg)
            return io.NodeOutput(None, None, None, False)

        # frames
        pattern = info.get("frame_pattern", LOSSLESS_FRAME_PATTERN)
        frame_count = int(info.get("frame_count", 0))
        frames = []
        for index in range(frame_count):
            frame_file = dir_path / pattern.format(index + 1)
            if not frame_file.is_file():
                raise ValueError(f"frame file missing : {frame_file}")
            with Image.open(frame_file) as img:
                frames.append(pillow_to_tensor(img.convert("RGB")))
        if not frames:
            raise ValueError(f"no frames in directory : {dir_path}")
        images = torch.cat(frames, dim=0)

        # audio
        audio = None
        audio_info = info.get("audio")
        if audio_info:
            audio_file = dir_path / audio_info.get("file", LOSSLESS_AUDIO_FILE)
            if not audio_file.is_file():
                raise ValueError(f"audio file missing : {audio_file}")
            waveform, sample_rate = load_audio_file(str(audio_file))
            audio = {"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate}

        fps = float(info.get("fps", 30.0))

        logger.info(f"Loaded directory : {dir_path} ({images.shape[0]} frames @ {fps} fps, audio: {'yes' if audio is not None else 'no'})")

        return io.NodeOutput(images, audio, fps, True)

# ===== INITIALIZATION =========================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        SaveVideoToPath,
        SaveLosslessVideoToPath,
        LoadVideoFromPath,
        LoadLosslessVideoFromPath,
    ]
