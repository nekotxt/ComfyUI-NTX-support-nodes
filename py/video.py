from comfy_api.latest import ComfyExtension, io, ui, InputImpl, Types
from comfy_extras.nodes_video import _save_video_codec_input

import folder_paths
from comfy.cli_args import args

from fractions import Fraction
from pathlib import Path

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger
from .utils import notify_user
from .images import COMFY_FOLDERS, get_comfy_folder, resolve_path

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

# ===== INITIALIZATION =========================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        SaveVideoToPath,
        LoadVideoFromPath,
    ]
