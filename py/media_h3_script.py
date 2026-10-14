from comfy_api.latest import io

import folder_paths
import nodes

import json
import os
import re

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger
from .media_loader import parse_prompt_media, decode_slot, normalize_tag, is_enabled, PARSER_KINDS
from .seed import SEED_MAX
from .utils import MEDIA_REFS_TYPE, DICT_TYPE, clone_data

# ===== Script utilities =======================================================================================================================

# the workflow types a clip can be made with
WF_TYPES = ("T2VA", "I2VA", "L2VA", "FL2VA", "Ref2VA")

# the duration in seconds (2 decimals) and its length in frames, kept in step by the frontend :
# length = 5 + 17 * ceil((max(5, round(duration * 24)) - 5) / 17), duration = round(length / 24, 2)
DEFAULT_DURATION = 5
MIN_DURATION = 0.01
MAX_DURATION = 600

DEFAULT_LENGTH = 124
MIN_LENGTH = 5
MAX_LENGTH = 14404

# the motion contexts a clip can continue with : "none", or "<N> video + <M> audio", the lengths
# of the context in video frames and audio latent frames, read from the text by context_lengths
# (a new entry only needs to follow that form)
CONTEXTS = ("none", "22 video + 24 audio", "39 video + 48 audio")
CONTEXT_PATTERN = re.compile(r"^\s*(\d+)\s*video\s*\+\s*(\d+)\s*audio\s*$", re.IGNORECASE)

# the (video, audio) lengths of a context, (0, 0) for "none" or a text not of the form
def context_lengths(context: str) -> tuple[int, int]:
    match = CONTEXT_PATTERN.match(context or "")
    return (int(match.group(1)), int(match.group(2))) if match else (0, 0)

# a version of a clip as the frontend creates it (web/js/media_h3_script.js)
DEFAULT_VERSION = {"wf_type": WF_TYPES[0], "duration": DEFAULT_DURATION, "length": DEFAULT_LENGTH, "context": CONTEXTS[0], "lora_stack": "", "noise_seed": 0, "prompt_base": "", "prompt_final": ""}

def clamp_index(value, length: int) -> int:
    try:
        index = int(value)
    except (TypeError, ValueError):
        index = 0
    return min(length - 1, max(0, index))

def parse_version(version: dict) -> dict:
    wf_type = version.get("wf_type")
    try:
        duration = round(float(version.get("duration", DEFAULT_DURATION)), 2)
    except (TypeError, ValueError, OverflowError):
        duration = DEFAULT_DURATION
    if duration != duration:  # NaN
        duration = DEFAULT_DURATION
    try:
        length = int(version.get("length", DEFAULT_LENGTH))
    except (TypeError, ValueError):
        length = DEFAULT_LENGTH
    try:
        noise_seed = int(version.get("noise_seed", 0))
    except (TypeError, ValueError):
        noise_seed = 0
    return {
        "wf_type": wf_type if wf_type in WF_TYPES else DEFAULT_VERSION["wf_type"],
        "duration": min(MAX_DURATION, max(MIN_DURATION, duration)),
        "length": min(MAX_LENGTH, max(MIN_LENGTH, length)),
        "context": version.get("context") if version.get("context") in CONTEXTS else DEFAULT_VERSION["context"],
        "lora_stack": str(version.get("lora_stack") or ""),
        "noise_seed": min(SEED_MAX, max(0, noise_seed)),
        "prompt_base": str(version.get("prompt_base") or ""),
        "prompt_final": str(version.get("prompt_final") or ""),
    }

# a clip of the older format, the fields without versions, is read as its version 0
def parse_clip(clip: dict) -> dict:
    if not isinstance(clip.get("versions"), list):
        return {"active": 0, "versions": [parse_version(clip)]}
    versions = [parse_version(version) for version in clip["versions"] if isinstance(version, dict)]
    if not versions:
        versions.append(dict(DEFAULT_VERSION))
    return {"active": clamp_index(clip.get("active", 0), len(versions)), "versions": versions}

# the clips_state widget holds a JSON object with the clips of the script, in order, and the index
# (from 0) of the active one, the tab selected on the node ; each clip holds its versions, in order,
# and the index (from 0, the version number) of its active one :
#   {"start_video": "", "guide_video": "", "active": 1, "clips": [{"active": 0, "versions": [
#       {"wf_type": "T2VA", "duration": 5, "length": 124, "context": "none", "lora_stack": "", "noise_seed": 0, "prompt_base": "...", "prompt_final": "..."}, ...]}, ...]}
# where lora_stack names an entry of the lora_stacks input (empty : none), and start_video and
# guide_video, settings of the whole script, the tags of video slots of the media input (empty : none)
# A missing or broken field gets its default, an empty list one default clip or version, and the
# active indexes are clamped to their lists
def parse_clips_state(clips_state: str) -> dict:
    try:
        state = json.loads(clips_state or "{}")
    except (TypeError, ValueError):
        state = {}
    if not isinstance(state, dict):
        state = {}

    clips = [parse_clip(clip) for clip in state.get("clips") or [] if isinstance(clip, dict)]
    if not clips:
        clips.append({"active": 0, "versions": [dict(DEFAULT_VERSION)]})
    return {"start_video": str(state.get("start_video") or ""), "guide_video": str(state.get("guide_video") or ""),
            "active": clamp_index(state.get("active", 0), len(clips)),
            "clips": clips}

# the video slot of a media bundle with the tag of a field (start_video, guide_video),
# case-insensitively like the @tag references of the prompt ; a tag no slot holds, held by a slot
# that is not a video, or by a slot switched off fails the prompt
def find_video(media: dict, field: str, tag_value: str) -> dict:
    key = tag_value.lower()
    videos = []
    for kind in PARSER_KINDS:
        for entry in media.get(kind, []):
            tag = normalize_tag(entry.get("tag")) if isinstance(entry, dict) else None
            if tag is None:
                continue
            if kind == "videos":
                videos.append(tag)
            if tag.lower() != key:
                continue
            spec = PARSER_KINDS[kind]
            if kind != "videos":
                raise ValueError(f"MediaH3Script : {field} {tag_value} is the tag of {spec['slot']} {int(entry['slot']) + 1} "
                                 f"({entry['name']}), not of a video")
            if not is_enabled(entry):
                raise ValueError(f"MediaH3Script : {field} {tag_value} : video {int(entry['slot']) + 1} ({entry['name']}) "
                                 "is switched off")
            return entry
    raise ValueError(f"MediaH3Script : {field} {tag_value} : no slot of the Media Loader has this tag "
                     f"(video tags of the Media Loader : {', '.join(videos) or 'none'})")

# ===== NODES ==================================================================================================================================

class MediaH3Script(io.ComfyNode):
    """The script of a video made of several clips, each one generated by its own run.

    The general settings of the video (project, width, height) are plain widgets ; the clips live
    in the clips_state widget (see parse_clips_state), a JSON string the frontend replaces on the
    node by a tabbed panel (web/js/media_h3_script.js) with one tab per clip, numbered from 1, and
    Add / Remove buttons. Each clip has versions, numbered from 0, in a second row of tabs (a new
    version is a copy of the active one) ; each version has a workflow type, a duration (in
    seconds) and its length (in frames), a context,
    a lora_stack, a noise_seed, a short prompt_base and an optional longer prompt_final ; the Picture / Video /
    Audio buttons above the prompts insert the @tag of a slot of the Media Loader in prompt_base
    (prompt_final is not parsed). Above the clips, start_video and guide_video are settings of the
    whole script : the tags of video slots of the Media Loader, typed or picked with their Video
    button. start_video's frames and audio go into the pipe as context_frames and context_audio on
    the first clip, guide_video's frames as guide_main_frames on every clip.

    A run works on the active version of the active clip, the tabs selected on the node : the
    general settings and the version's fields go into the pipe (project, width, height, clip_index,
    version_index, wf_type, duration, length, context_frames_length, context_audio_length, noise_seed, prompt_base, prompt_final), prompt_base being parsed exactly
    as by the Media Parser first :
    its @tag references become <Picture N> / <Video N> / <Audio N> labels and the referenced media
    are decoded into the pipe as picture_N, video_N + video_audio_N and audio_N. An empty (or blank
    only) prompt_final gets the parsed prompt_base. A clip naming a lora_stack puts the entry of
    the lora_stacks input of that name into the pipe as lora_stack (nothing when there is none).
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}MediaH3Script",
            display_name=f"{ADDON_PREFIX} Media H3 Script",
            description="Define the general settings of a video and the settings of its clips (one tab per clip). A run puts "
                        "the settings and the active clip into the pipe, its prompt_base parsed like the Media Parser does "
                        "(@tag references replaced by <Picture N> / <Video N> / <Audio N>, the media decoded into the pipe).",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                MEDIA_REFS_TYPE.Input("media", tooltip="The media bundle of a Media Loader node."),
                DICT_TYPE.Input("pipe", optional=True, tooltip="A pipe the settings and media are added to (a new one when not connected)."),
                DICT_TYPE.Input("lora_stacks", optional=True,
                                tooltip="The LoRA stacks of the video (a pipe of LORA_STACK), the clips picking theirs by name."),
                io.String.Input("project", default="", tooltip="The identifier name of the video project."),
                io.Int.Input("width", default=1280, min=64, max=8192, step=16, tooltip="The width of the video."),
                io.Int.Input("height", default=720, min=64, max=8192, step=16, tooltip="The height of the video."),
                # the clips : the frontend swaps this string widget for its tabbed panel
                io.String.Input("clips_state", default="{}", socketless=True),
            ],
            outputs=[
                DICT_TYPE.Output("pipe"),
                io.Int.Output("clip_index"),
                io.String.Output("prompt_base"),
                io.String.Output("report"),
            ],
        )

    @classmethod
    def execute(cls, media, project, width, height, clips_state, pipe=None, lora_stacks=None) -> io.NodeOutput:
        logger.node_name("MediaH3Script")
        pipe = {} if pipe is None else clone_data(pipe)
        state = parse_clips_state(clips_state)
        clip_index = state["active"] + 1
        version_index = state["clips"][state["active"]]["active"]
        clip = state["clips"][state["active"]]["versions"][version_index]
        logger.info(f"clip {clip_index} of {len(state['clips'])}, version {version_index} : {clip['wf_type']}, {clip['duration']} s, {clip['length']} frames")

        # the general settings, then the active version of the active clip
        pipe["project"] = project
        pipe["width"] = width
        pipe["height"] = height
        pipe["clip_index"] = clip_index
        pipe["version_index"] = version_index
        pipe["wf_type"] = clip["wf_type"]
        pipe["duration"] = clip["duration"]
        pipe["length"] = clip["length"]
        pipe["context_frames_length"], pipe["context_audio_length"] = context_lengths(clip["context"])
        pipe["noise_seed"] = clip["noise_seed"]

        # the media referenced by prompt_base decoded into the pipe, then the parsed prompt
        prompt_base, report = parse_prompt_media("MediaH3Script", media, clip["prompt_base"], pipe)
        pipe["prompt_base"] = prompt_base

        # the clip's LoRA stack, picked by name in lora_stacks ; nothing in the pipe when not found
        stack_name = clip["lora_stack"].strip()
        if stack_name:
            stack = lora_stacks.get(stack_name) if isinstance(lora_stacks, dict) else None
            if stack is not None:
                pipe["lora_stack"] = stack
                logger.info(f"lora_stack : {stack_name} ({len(stack) if isinstance(stack, (list, tuple)) else '?'} LoRAs)")
            else:
                logger.warning(f"lora_stack : {stack_name} not found in lora_stacks, no lora_stack in the pipe")

        # the first clip continues the video tagged start_video, if any : its frames and audio, with
        # their edits applied, become the chain the H3 Motion Context nodes continue
        start_video = state["start_video"].strip()
        if start_video and clip_index <= 1:
            entry = find_video(media if isinstance(media, dict) else {}, "start_video", start_video)
            pipe["context_frames"] = decode_slot("context_frames", "video_frames", entry)
            pipe["context_audio"] = decode_slot("context_audio", "video_audio", entry)
            report += f"\nstart_video {start_video} => context_frames + context_audio => video {int(entry['slot']) + 1} ({entry['name']})"

        # the video tagged guide_video, if any, on every clip : its frames only, with their edits applied
        guide_video = state["guide_video"].strip()
        if guide_video:
            entry = find_video(media if isinstance(media, dict) else {}, "guide_video", guide_video)
            pipe["guide_main_frames"] = decode_slot("guide_main_frames", "video_frames", entry)
            report += f"\nguide_video {guide_video} => guide_main_frames => video {int(entry['slot']) + 1} ({entry['name']})"

        # an empty prompt_final (or blank only) falls back on the parsed prompt_base
        pipe["prompt_final"] = clip["prompt_final"] if clip["prompt_final"].strip() else prompt_base

        return io.NodeOutput(pipe, clip_index, prompt_base, report)

# the nodes of the H3-Motion-Context extension called by LoadH3MotionContextLatent and
# SaveH3MotionContextLatent, by class name and display name
H3_LOAD_LATENT_NODE = ("MiniMaxH3MotionContextLoadLatent", "H3 Motion Context Load Latent")
H3_SAVE_LATENT_NODE = ("MiniMaxH3MotionContextSaveLatent", "H3 Motion Context Save Latent")

# run a node of the H3-Motion-Context extension (a V1 node, run through its FUNCTION) and return
# its outputs ; the extension not being installed fails the prompt
def run_h3_node(caller: str, node: tuple[str, str], **kwargs) -> tuple:
    node_class = nodes.NODE_CLASS_MAPPINGS.get(node[0])
    if node_class is None:
        raise RuntimeError(f"{caller} : the {node[1]} node is not available, "
                           "install the H3-Motion-Context extension (ComfyUI-H3-Motion-Context)")
    return getattr(node_class(), node_class.FUNCTION)(**kwargs)

# the clip_index of a pipe, 0 when it has none
def pipe_clip_index(pipe: dict) -> int:
    try:
        return int(pipe.get("clip_index", 0))
    except (TypeError, ValueError):
        return 0

# the folder of the latents, relative to the output folder : <latent_dir>/<project>/<subdir>,
# project coming from the pipe, the empty parts skipped
def h3_latent_dir(latent_dir: str, pipe: dict, subdir: str) -> str:
    parts = [str(part).strip() for part in (latent_dir, pipe.get("project"), subdir) if part is not None]
    return os.path.join(*[part for part in parts if part] or [""])

# the file the H3 Motion Context Save Latent node writes for a clip, with the filename_prefix
# "<latent_dir>/clip" and that clip's index
def h3_latent_path(latent_dir: str, clip_index: int) -> str:
    return os.path.join(folder_paths.get_output_directory(), latent_dir, f"clip_{clip_index:05d}.safetensors")

class LoadH3MotionContextLatent(io.ComfyNode):
    """Load the saved latent of the clip before the pipe's clip, for the H3 Motion Context node.

    The folder of the latents is <latent_dir>/<project>/<subdir>, project coming from the pipe, an
    empty part being skipped. The clip_index of the pipe is the clip being generated : the clip it
    continues from is the one before, whose latent the H3 Motion Context Save Latent node wrote as
    <output>/<folder>/clip_<index, 5 digits>.safetensors. When that file exists, it is loaded by the
    H3 Motion Context Load Latent node of the H3-Motion-Context extension (latent_path = the
    folder, clip_index = the previous clip). The first clip continues nothing, and a missing file
    is not an error : the output is then None. The counter widget is not used : changing it only
    forces the node to run again.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadH3MotionContextLatent",
            display_name=f"{ADDON_PREFIX} Load H3 Motion Context Latent",
            description="Load the motion context latent of the clip before the pipe's clip_index (saved by H3 Motion Context "
                        "Save Latent in <output>/<latent_dir>/<project>/<subdir>/clip_NNNNN.safetensors), through the H3 "
                        "Motion Context Load Latent node. None for the first clip, or when the file does not exist.",
            category=f"{ADDON_CATEGORY}/images",
            inputs=[
                DICT_TYPE.Input("pipe", tooltip="A pipe holding clip_index, the clip being generated (from a Media H3 Script)."),
                io.String.Input("latent_dir", default="h3_context",
                                tooltip="The folder of the saved latents, relative to the ComfyUI output folder ; the "
                                        "project of the pipe and subdir are appended to it."),
                io.String.Input("subdir", default="",
                                tooltip="A subfolder of <latent_dir>/<project> (skipped when empty)."),
                io.Int.Input("counter", default=0, min=0, max=0xFFFFFFFF,
                             tooltip="Not used : change it to force the node to run again, regardless of the cache."),
            ],
            outputs=[
                io.Latent.Output("latent", tooltip="The latent of the previous clip, for the context_latent input of "
                                                   "H3 Motion Context ; None when there is none."),
            ],
        )

    @classmethod
    def execute(cls, pipe, latent_dir, subdir="", counter=0) -> io.NodeOutput:
        logger.node_name("LoadH3MotionContextLatent")
        pipe = pipe if isinstance(pipe, dict) else {}
        clip_index = pipe_clip_index(pipe)
        if clip_index <= 1:
            logger.info(f"clip {clip_index} : no previous clip, no latent")
            return io.NodeOutput(None)

        previous = clip_index - 1
        latent_dir = h3_latent_dir(latent_dir, pipe, subdir)
        path = h3_latent_path(latent_dir, previous)
        if not os.path.isfile(path):
            logger.warning(f"clip {clip_index} : no latent of clip {previous} ({path}), no latent")
            return io.NodeOutput(None)

        latent = run_h3_node("LoadH3MotionContextLatent", H3_LOAD_LATENT_NODE, latent_path=latent_dir, clip_index=previous)[0]
        logger.info(f"clip {clip_index} : latent of clip {previous} loaded ({path})")
        return io.NodeOutput(latent)

class SaveH3MotionContextLatent(io.ComfyNode):
    """Save the latent of the pipe's clip, for the next clip's LoadH3MotionContextLatent.

    The latent is saved by the H3 Motion Context Save Latent node of the H3-Motion-Context
    extension, with the filename_prefix <latent_dir>/<project>/<subdir>/clip (project coming from
    the pipe, an empty part being skipped) and the clip_index of the pipe : the file is
    <output>/<folder>/clip_<index, 5 digits>.safetensors, the one LoadH3MotionContextLatent reads
    for the next clip. A clip_index of 0 (or none in the pipe) is the extension's auto mode, a new
    run-numbered file each run.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SaveH3MotionContextLatent",
            display_name=f"{ADDON_PREFIX} Save H3 Motion Context Latent",
            description="Save the AV latent of the pipe's clip_index in <output>/<latent_dir>/<project>/<subdir>/"
                        "clip_NNNNN.safetensors through the H3 Motion Context Save Latent node, for the next clip's "
                        "Load H3 Motion Context Latent.",
            category=f"{ADDON_CATEGORY}/images",
            is_output_node=True,
            inputs=[
                DICT_TYPE.Input("pipe", tooltip="A pipe holding clip_index and project (from a Media H3 Script)."),
                io.Latent.Input("latent", tooltip="The sampler's output latent of the clip."),
                io.String.Input("latent_dir", default="h3_context",
                                tooltip="The folder of the saved latents, relative to the ComfyUI output folder ; the "
                                        "project of the pipe and subdir are appended to it."),
                io.String.Input("subdir", default="",
                                tooltip="A subfolder of <latent_dir>/<project> (skipped when empty)."),
            ],
            outputs=[
                io.String.Output("latent_path", tooltip="The path of the saved file."),
            ],
        )

    @classmethod
    def execute(cls, pipe, latent, latent_dir, subdir="") -> io.NodeOutput:
        logger.node_name("SaveH3MotionContextLatent")
        pipe = pipe if isinstance(pipe, dict) else {}
        clip_index = pipe_clip_index(pipe)
        filename_prefix = os.path.join(h3_latent_dir(latent_dir, pipe, subdir), "clip")
        latent_path = run_h3_node("SaveH3MotionContextLatent", H3_SAVE_LATENT_NODE,
                                  latent=latent, filename_prefix=filename_prefix, clip_index=clip_index)[0]
        logger.info(f"clip {clip_index} : latent saved ({latent_path})")
        return io.NodeOutput(latent_path)

# ===== INITIALIZATION =========================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        MediaH3Script,
        LoadH3MotionContextLatent,
        SaveH3MotionContextLatent,
    ]
