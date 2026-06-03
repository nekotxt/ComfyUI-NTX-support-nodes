from comfy_api.latest import ComfyExtension, io

import comfy.sd
import comfy.utils
import folder_paths

import json
import os
import re
from pathlib import Path
from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, MODELS_DIR, MAX_CACHED_LORAS, DOWNLOAD_MISSING_LORAS, CLOUD_STORAGE_ID
from .logging import logger
from .utils import clone_data, download_file_from_cloud, LORA_STACK_TYPE

# ===== LoRA utilities =================================================================================================================

# used by ApplyLoraStack
CACHED_LORAS = []
logger.info(f"MAX_CACHED_LORAS = {MAX_CACHED_LORAS}")

def normalize_lora_name(lora_name:str):
    if lora_name.endswith(".safetensors") == False:
        lora_name += ".safetensors"

    lora_name = lora_name.replace("\\", os.path.sep).replace("/", os.path.sep)

    return lora_name

def extract_lora_strings(text):
    """
    Extract strings formatted as <lora:name:value1[:value2]>
    Args:
        text (str): Input text to search for lora-formatted strings
    Returns:
        list of tuples: Each tuple contains (lora_name, strength_model, strength_clip),
        where strength_model = strength_clip if not present in the string
    """

    # Regular expression pattern to match <lora:name:value1[:value2]> format
    # (?::([^>]+))? makes the :value2 part optional
    pattern = r'<lora:([^:]+):([^:>]+)(?::([^>]+))?>'

    # Find all matches in the text
    matches = re.findall(pattern, text)

    loras_stack = []
    for match in matches:
        lora_name, strength_model, strength_clip = match

        lora_name = normalize_lora_name(lora_name)

        if strength_clip:
            loras_stack.append((lora_name, float(strength_model), float(strength_clip)), )
        else:
            loras_stack.append((lora_name, float(strength_model), float(strength_model)), )

    return loras_stack

def remove_text_between_angle_brackets(text):
    """
    Remove all text between < and > from the input string
    Args:
        text (str): Input text containing angle-bracketed sections
    Returns:
        str: Text with all angle-bracketed sections removed
    """
    # Use regex to remove text between < and >
    cleaned_text = re.sub(r'<[^>]*>', '', text)

    # Optional: Remove multiple consecutive whitespaces created by removal
    cleaned_text = re.sub(r'\s+', ' ', cleaned_text).strip()

    return cleaned_text

def format_lora_as_string(lora_name, strength_model, strength_clip, compact_form=False):
    strength_model = round(strength_model, 2)
    strength_clip  = round(strength_clip , 2)
    if compact_form:
        if strength_model == strength_clip:
            return f"<lora:{lora_name}:{strength_model}>"
        else:
            return f"<lora:{lora_name}:{strength_model}:{strength_clip}>"
    else:
        return f"<lora:{lora_name}:{strength_model}:{strength_clip}>"

LIST_OF_LORA_DIRS = None
def solve_lora_name(lora_name:str):
    # logger.info(f"Solve lora name [{lora_name}]")

    lora_path = ""
    try:
        lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)
        # logger.info(f"- found [{lora_name}] => {lora_path}")
        return (lora_name, lora_path)
    except Exception as e:
        logger.info(f"- {e}")

    # generate the list of candidate dirs, if needed
    global LIST_OF_LORA_DIRS
    if LIST_OF_LORA_DIRS is None:
        logger.info("RETRIEVE LIST OF LORA DIRS")
        LIST_OF_LORA_DIRS = []
        for lora_dir in folder_paths.folder_names_and_paths.get("loras", ([], []))[0]:
            lora_dir_path = Path(lora_dir)
            for subdir in lora_dir_path.rglob("*"):
                if subdir.is_dir():
                    LIST_OF_LORA_DIRS.append((lora_dir, subdir))

    # try with file name only
    lora_name_short = Path(lora_name).name
    for (lora_dir, subdir) in LIST_OF_LORA_DIRS:
        # logger.info(f"- try with dir:{subdir}")
        lora_path = subdir / lora_name_short
        if lora_path.exists():
            lora_path = str(lora_path)
            lora_name_updated = lora_path[len(lora_dir)+1:]
            logger.info(f"- found [{lora_name}] => [{lora_name_updated}] => {lora_path}")
            return (lora_name_updated, lora_path)

    # it could not find the model
    return (lora_name, None)

# ===== NODES ==============================================================================================================================

class LoraStack(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoraStack",
            display_name=f"{ADDON_PREFIX} Lora Stack",
            description="",
            category=f"{ADDON_CATEGORY}/loras",
            inputs=[
                io.String.Input("loras_data", default="[]"),
                LORA_STACK_TYPE.Input("lora_stack", optional=True),
            ],
            outputs=[
                LORA_STACK_TYPE.Output("lora_stack"),
            ],
        )

    @classmethod
    def execute(cls, loras_data, lora_stack=None):
        try:
            data = json.loads(loras_data)
            if isinstance(data, list):
                # backward-compat: old format was a bare array
                loras, common_strength = data, False
            elif isinstance(data, dict):
                loras = data.get("loras", [])
                common_strength = bool(data.get("commonStrength", False))
            else:
                loras, common_strength = [], False
        except (json.JSONDecodeError, TypeError):
            loras, common_strength = [], False

        stack = [] if lora_stack is None else clone_data(lora_stack)
        for entry in loras:
            if not isinstance(entry, dict):
                continue
            if not entry.get("enabled", True):
                continue
            name = entry.get("name", "")
            if not name or name == "none":
                continue
            model_str = float(entry.get("modelStrength", 1.0))
            clip_str  = model_str if common_strength else float(entry.get("clipStrength", 1.0))
            stack.append((name, model_str, clip_str))

        return io.NodeOutput(stack)

class MergeLoraStacks(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}MergeLoraStacks",
            display_name=f"{ADDON_PREFIX} Merge Lora Stacks",
            description="Merge two lora stacks",
            category=f"{ADDON_CATEGORY}/loras",
            inputs=[
                LORA_STACK_TYPE.Input("lora_stack_1", optional=True),
                LORA_STACK_TYPE.Input("lora_stack_2", optional=True),
            ],
            outputs=[
                LORA_STACK_TYPE.Output("lora_stack"),
            ],
        )

    @classmethod
    def execute(cls, lora_stack_1=None, lora_stack_2=None):

        merged_lora_stack = []

        if lora_stack_1 is not None:
            for (name, s1, s2) in lora_stack_1:
                merged_lora_stack.append((name, s1, s2))

        if lora_stack_2 is not None:
            for (name, s1, s2) in lora_stack_2:
                merged_lora_stack.append((name, s1, s2))

        return io.NodeOutput(merged_lora_stack)

class ApplyLoraStack(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ApplyLoraStack",
            display_name=f"{ADDON_PREFIX} Apply Lora Stack",
            description="Apply lora stack to model and (optionally) clip",
            category=f"{ADDON_CATEGORY}/loras",
            inputs=[
                LORA_STACK_TYPE.Input("lora_stack"),
                io.Model.Input("model"),
                io.Clip.Input("clip", optional=True),
            ],
            outputs=[
                LORA_STACK_TYPE.Output("lora_stack"),
                io.Model.Output("model"),
                io.Clip.Output("clip"),
            ],
        )

    @classmethod
    def execute(cls, lora_stack, model, clip=None):

        global CACHED_LORAS
        global MAX_CACHED_LORAS
        global DOWNLOAD_MISSING_LORAS
        global CLOUD_STORAGE_ID
        global MODELS_DIR

        if lora_stack is None:
            return io.NodeOutput(lora_stack, model, clip)

        if len(lora_stack) == 0:
            return io.NodeOutput(lora_stack, model, clip)

        logger.info("ApplyLoraStack :")
        applied_lora_stack = []
        for (lora_name, strength_model, strength_clip) in lora_stack:
            if strength_model == 0 and strength_clip == 0:
                logger.info(f"- SKIP [{lora_name}] - strength=0")
                continue

            duplicated = False
            for (applied_lora_name, _, _) in applied_lora_stack:
                if lora_name == applied_lora_name:
                    duplicated = True
                    break
            if duplicated:
                logger.info(f"- SKIP [{lora_name}] - already applied")
                continue

            (lora_name, lora_path) = solve_lora_name(lora_name)
            if lora_path is None:
                # lora file not present, try to get it from cloud or raise an error
                if (CLOUD_STORAGE_ID == "") or (DOWNLOAD_MISSING_LORAS == False):  
                    # download from cloud is not required or not possible: just notify the error              
                    logger.warning(f"- ERROR [{lora_name}] model file not found")
                    continue
                else:
                    # try to download from cloud
                    logger.warning(f"- [{lora_name}] model file not found, attempting to download from {CLOUD_STORAGE_ID} ...")
                    lora_name = normalize_lora_name(lora_name)
                    save_path = MODELS_DIR / "loras" / Path(lora_name)
                    (dl_result, dl_message) = download_file_from_cloud(
                            cloud_storage_id=CLOUD_STORAGE_ID, 
                            model_subpath="loras" / Path(lora_name), 
                            save_path=save_path
                        )
                    if dl_result:
                        # success: proceed with next steps
                        logger.info(f"- {dl_message}")
                        lora_path = str(save_path)
                    else:
                        # failure: stop
                        logger.warning(f"- ERROR {dl_message}")
                        continue

            try:
                lora = None
                for(cached_lora_path, cached_lora) in CACHED_LORAS:
                    if cached_lora_path == lora_path:
                        lora = cached_lora
                        break

                if lora is None:
                    lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                    CACHED_LORAS.append([lora_path, lora])
                    msg = "loaded from disk (added to cache)"
                else:
                    msg = "retrieved from cache"

                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, strength_model, strength_clip)

                applied_lora_stack.append([lora_name, strength_model, strength_clip])

                logger.info(f"- OK [{lora_name}] - {msg}")
            except Exception as e:
                logger.info(f"- ERROR [{lora_name}] - {e}")

        logger.info("Final stack :")
        for (lora_name, strength_model, strength_clip) in applied_lora_stack:
            logger.info(f"- {lora_name} {strength_model} {strength_clip}")

        logger.info("Current cache :")
        for (cached_lora_path, _) in CACHED_LORAS:
            logger.info(f"- {cached_lora_path}")

        if len(CACHED_LORAS) > MAX_CACHED_LORAS:
            logger.info(f"Pruning cache (max={MAX_CACHED_LORAS}):")
            while len(CACHED_LORAS) > MAX_CACHED_LORAS:
                (cached_lora_path, cached_lora) = CACHED_LORAS.pop(0)
                logger.info(f"- remove {cached_lora_path}")
            logger.info("Final cache :")
            for (cached_lora_path, _) in CACHED_LORAS:
                logger.info(f"- {cached_lora_path}")

        return io.NodeOutput(applied_lora_stack, model, clip)

class ConvertLoraStackToString(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ConvertLoraStackToString",
            display_name=f"{ADDON_PREFIX} Convert Lora Stack To String",
            description="Convert a list of LoRAs into a string",
            category=f"{ADDON_CATEGORY}/loras",
            inputs=[
                LORA_STACK_TYPE.Input("lora_stack", optional=True),
            ],
            outputs=[
                io.String.Output("stack_text"),
            ],
        )

    @classmethod
    def execute(cls, lora_stack=None):

        text = ""

        if lora_stack is not None:
            for lora_def in lora_stack:
                if len(lora_def) >= 3:
                    text += format_lora_as_string(lora_def[0], lora_def[1], lora_def[2]) + "\n"
                elif len(lora_def) >= 2:
                    text += format_lora_as_string(lora_def[0], lora_def[1], lora_def[1]) + "\n"
                elif len(lora_def) >= 1:
                    text += format_lora_as_string(lora_def[0], 1.0, 1.0) + "\n"

        return io.NodeOutput(text)

class ConvertLoraStringToStack(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ConvertLoraStringToStack",
            display_name=f"{ADDON_PREFIX} Convert Lora String To Stack",
            description="Parse a text prompt and convert the LoRA references to a stack",
            category=f"{ADDON_CATEGORY}/loras",
            inputs=[
                io.String.Input("prompt", multiline=False, dynamic_prompts=False, default=""),
                LORA_STACK_TYPE.Input("initial_lora_stack", optional=True),
            ],
            outputs=[
                io.String.Output("clean_prompt"),
                LORA_STACK_TYPE.Output("final_lora_stack"),
            ],
        )

    @classmethod
    def execute(cls, prompt, initial_lora_stack=None):

        if initial_lora_stack is None:
            initial_lora_stack = []

        final_lora_stack = initial_lora_stack + extract_lora_strings(prompt)

        clean_prompt = remove_text_between_angle_brackets(prompt)

        return io.NodeOutput(clean_prompt, final_lora_stack)

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        LoraStack,
        MergeLoraStacks,
        ApplyLoraStack,
        ConvertLoraStackToString,
        ConvertLoraStringToStack,
    ]
