from comfy_api.latest import ComfyExtension, io

import comfy.samplers
import comfy.sd
import comfy.utils
import folder_paths

import os
import re
import shutil
import torch
import json
from pathlib import Path
from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, SETTINGS_DIR
from .logging import log_info, log_warning

#SETTINGS_DIR = Path.cwd() / "input" / "ntx_data"

# used by ApplyLoraStack
CACHED_LORAS = []
MAX_CACHED_LORAS = 5

def util_setup(max_cached_loras:int):
    global MAX_CACHED_LORAS

    MAX_CACHED_LORAS = max_cached_loras
    log_info(f"MAX_CACHED_LORAS = {MAX_CACHED_LORAS}")

# ===== Custom types ===========================================================================================================================

DICT_TYPE = io.Custom("DICT")
LIST_TYPE = io.Custom("LIST")
LORA_STACK_TYPE = io.Custom("LORA_STACK")
CONTROL_NET_STACK_TYPE = io.Custom("CONTROL_NET_STACK")

# ===== General use functions ==================================================================================================================

# check empty string
def is_string_empty(string):
    return not string or string.isspace()

# utility function to make a semi-deep copy of an object
# (it duplicates simple data types like string, int ..., and also duplicates dict and list,
#  but not complex objects like models or images)
def clone_data(data):
    if type(data) is dict:
        new_dict = {}
        for k,v in data.items():
            new_dict[k] = clone_data(v)
        return new_dict
    elif type(data) is list:
        new_list = []
        for entry in data:
            new_list.append(clone_data(entry))
        return new_list
    elif type(data) is tuple:
        new_tuple = tuple(clone_data(item) for item in data)
        return new_tuple
    else:
        return data

# utility function to merge a dictionary into another, with a logic similar to clone_data
def dict_merge(base:dict, overwrite:dict):
    for k,v in overwrite.items():
        if type(v) is dict:
            if k in base and base[k] is not None:
                dict_merge(base[k], v)
            else:
                base[k] = clone_data(v)
        elif type(v) is list:
            if k in base and base[k] is not None:
                for entry in v:
                    base[k].append(clone_data(entry))
            else:
                base[k] = clone_data(v)
        else:
            base[k] = clone_data(v)

# utility for cleaning path names
def clean_path(path:str):
    return path.replace("\\", os.path.sep).replace("/", os.path.sep)

# ===== UTILITY FUNCTIONS TO RETRIEVE INFORMATION ========================================================================================

def load_list_ckpts():
    return folder_paths.get_filename_list("checkpoints")

def load_list_unets():
    return folder_paths.get_filename_list("unet")

def load_list_clips():
    return folder_paths.get_filename_list("clip")

def load_list_loras():
    return folder_paths.get_filename_list("loras")

def load_list_vaes():
    return folder_paths.get_filename_list("vae") #["Baked VAE"] +

def load_list_samplers():
    return comfy.samplers.KSampler.SAMPLERS

def load_list_schedulers():
    return comfy.samplers.KSampler.SCHEDULERS

image_sizes_file = SETTINGS_DIR / "image_sizes.txt"
if image_sizes_file.is_file():
    IMAGE_SIZES = image_sizes_file.read_text(encoding="utf-8").splitlines()
else:
    IMAGE_SIZES = ["512x512", "512x768", "768x512", "832x1216", "1216x832", "896x1152", "1152x896", "1024x1024", "1024x1536", "1536x1024"]
def load_list_image_sizes():
    global IMAGE_SIZES
    return IMAGE_SIZES
def extract_image_size(image_size):
    match = re.search(r'([\d]+)x([\d]+)', image_size)
    if match is None:
        return (512, 512)
    else:
        return (int(match[1]), int(match[2]))


# ===== LoRA utilities =================================================================================================================

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

        if lora_name.endswith(".safetensors") == False:
            lora_name += ".safetensors"

        lora_name = lora_name.replace("\\", os.path.sep).replace("/", os.path.sep)

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
    # log_info(f"Solve lora name [{lora_name}]")

    lora_path = ""
    try:
        lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)
        # log_info(f"- found [{lora_name}] => {lora_path}")
        return (lora_name, lora_path)
    except Exception as e:
        log_info(f"- {e}")

    # generate the list of candidate dirs, if needed
    global LIST_OF_LORA_DIRS
    if LIST_OF_LORA_DIRS is None:
        log_info("RETRIEVE LIST OF LORA DIRS")
        LIST_OF_LORA_DIRS = []
        for lora_dir in folder_paths.folder_names_and_paths.get("loras", ([], []))[0]:
            lora_dir_path = Path(lora_dir)
            for subdir in lora_dir_path.rglob("*"):
                if subdir.is_dir():
                    LIST_OF_LORA_DIRS.append((lora_dir, subdir))

    # try with file name only
    lora_name_short = Path(lora_name).name
    for (lora_dir, subdir) in LIST_OF_LORA_DIRS:
        # log_info(f"- try with dir:{subdir}")
        lora_path = subdir / lora_name_short
        if lora_path.exists():
            lora_path = str(lora_path)
            lora_name_updated = lora_path[len(lora_dir)+1:]
            log_info(f"- found [{lora_name}] => [{lora_name_updated}] => {lora_path}")
            return (lora_name_updated, lora_path)

    # it could not find the model
    return (lora_name, None)

# ===== NODES : UTILITIES ==================================================================================================================

class ReplaceTextParameters(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ReplaceTextParameters",
            display_name=f"{ADDON_PREFIX} Replace Text Parameters",
            description="""
    Replace text parameters.
    The parameters must be in the form '%%name%%'
    For instance, if text='in the style of %%artist%%'
    and parameters contains an entry 'artist': 'anime'
    then the returned text will be 'in the style of anime'
    If the parameter name is not found in the dictionary, it will be replaced with an empty string.
    """,
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.String.Input("text", default=""),
                DICT_TYPE.Input("parameters", optional=True),
            ],
            outputs=[
                io.String.Output("text"),
            ],
        )

    @classmethod
    def execute(cls, text, parameters=None):

        if parameters is None:
            parameters = {}

        pattern = r'%%([^%]+)%%'
        matches = re.findall(pattern, text)
        for match in matches:
            text = text.replace(f"%%{match}%%", parameters.get(match, ""))

        return io.NodeOutput(text)


class SwitchAny(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SwitchAny",
            display_name=f"{ADDON_PREFIX} Switch Any",
            description="Return the first non-null input, or None if all inputs are missing",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.AnyType.Input("input1", optional=True),
                io.AnyType.Input("input2", optional=True),
                io.AnyType.Input("input3", optional=True),
                io.AnyType.Input("input4", optional=True),
                io.AnyType.Input("input5", optional=True),
            ],
            outputs=[
                io.AnyType.Output("output"),
            ],
        )

    @classmethod
    def execute(cls, input1=None, input2=None, input3=None, input4=None, input5=None):
        if input1 is not None:
            return io.NodeOutput(input1)
        if input2 is not None:
            return io.NodeOutput(input2)
        if input3 is not None:
            return io.NodeOutput(input3)
        if input4 is not None:
            return io.NodeOutput(input4)
        return io.NodeOutput(input5)


class LoadCustomVae(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadCustomVae",
            display_name=f"{ADDON_PREFIX} Load Custom Vae",
            description="If the flag is set to True, load the specified vae",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Boolean.Input("use_custom_vae", default=True, label_on="yes", label_off="no",
                                 tooltip="if yes, load and pass the specified VAE, instead of the input value"),
                io.Combo.Input("vae_name", options=load_list_vaes()),
                io.Vae.Input("vae", optional=True),
            ],
            outputs=[
                io.Vae.Output("vae"),
                io.String.Output("vae_name"),
            ],
        )

    @classmethod
    def execute(cls, use_custom_vae, vae_name, vae=None):

        if use_custom_vae:
            from nodes import VAELoader # the nodes module can be referenced, because its path is added to sys.path in __init__
            (vae, ) = VAELoader().load_vae(vae_name)
        else:
            vae_name = ""

        return io.NodeOutput(vae, vae_name)


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
            ],
            outputs=[
                LORA_STACK_TYPE.Output("lora_stack"),
            ],
        )

    @classmethod
    def execute(cls, loras_data):
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

        stack = []
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

        if lora_stack is None:
            return io.NodeOutput(lora_stack, model, clip)

        if len(lora_stack) == 0:
            return io.NodeOutput(lora_stack, model, clip)

        log_info("ApplyLoraStack :")
        applied_lora_stack = []
        for (lora_name, strength_model, strength_clip) in lora_stack:
            if strength_model == 0 and strength_clip == 0:
                log_info(f"- SKIP [{lora_name}] - strength=0")
                continue

            duplicated = False
            for (applied_lora_name, _, _) in applied_lora_stack:
                if lora_name == applied_lora_name:
                    duplicated = True
                    break
            if duplicated:
                log_info(f"- SKIP [{lora_name}] - already applied")
                continue

            (lora_name, lora_path) = solve_lora_name(lora_name)
            if lora_path is None:
                log_info(f"- ERROR [{lora_name}] model file not found")
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

                log_info(f"- OK [{lora_name}] - {msg}")
            except Exception as e:
                log_info(f"- ERROR [{lora_name}] - {e}")

        log_info("Final stack :")
        for (lora_name, strength_model, strength_clip) in applied_lora_stack:
            log_info(f"- {lora_name} {strength_model} {strength_clip}")

        log_info("Current cache :")
        for (cached_lora_path, _) in CACHED_LORAS:
            log_info(f"- {cached_lora_path}")

        if len(CACHED_LORAS) > MAX_CACHED_LORAS:
            log_info(f"Pruning cache (max={MAX_CACHED_LORAS}):")
            while len(CACHED_LORAS) > MAX_CACHED_LORAS:
                (cached_lora_path, cached_lora) = CACHED_LORAS.pop(0)
                log_info(f"- remove {cached_lora_path}")
            log_info("Final cache :")
            for (cached_lora_path, _) in CACHED_LORAS:
                log_info(f"- {cached_lora_path}")

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


class CreateImageLatent(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}CreateImageLatent",
            display_name=f"{ADDON_PREFIX} Create Image Latent",
            description="""Build the latents from the specified image size. If an image is provided, its size will be used.
                    To customize the list of image sizes, create a file /input/ntx_data/image_sizes.txt
                    and write the sizes, one for each row, int the form WIDTHxHEIGHT""",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Combo.Input("image_size", options=["custom"] + load_list_image_sizes(), default="custom"),
                io.Int.Input("width", default=0, min=0, max=4096, step=1),
                io.Int.Input("height", default=0, min=0, max=4096, step=1),
                io.Int.Input("batch_size", default=1, min=1, max=24),
                io.Image.Input("opt_image", optional=True),
                io.Vae.Input("vae", optional=True),
                io.Combo.Input("opt_image_size", options=["use image size", "crop to input size", "resize and use new size"], optional=True),
                io.Boolean.Input("opt_image_encode", default=True, label_on="yes", label_off="no", optional=True),
            ],
            outputs=[
                io.Int.Output("width"),
                io.Int.Output("height"),
                io.Int.Output("batch_size"),
                io.Latent.Output("latent"),
                io.Image.Output("opt_image"),
            ],
        )

    @classmethod
    def execute(cls, image_size, width, height, batch_size, opt_image=None, vae=None, opt_image_size=None, opt_image_encode=True):

        if image_size != "custom": # decode standard image size if any
            width, height = extract_image_size(image_size)

        if opt_image is not None:
            if opt_image_size == "crop to input size":
                opt_image = comfy.utils.common_upscale(opt_image.movedim(-1, 1), width, height, "lanczos", "center").movedim(1, -1)
            elif opt_image_size == "resize and use new size":
                image_w = opt_image.shape[2]
                image_h = opt_image.shape[1]

                ratio_w = width / image_w
                ratio_h = height / image_h
                if ratio_w < ratio_h:
                    final_width = width
                    final_height = round(image_h * ratio_w)
                else:
                    final_width = round(image_w * ratio_h)
                    final_height = height

                opt_image = comfy.utils.common_upscale(opt_image.movedim(-1, 1), final_width, final_height, "lanczos", "disabled").movedim(1, -1)
                width = opt_image.shape[2]
                height = opt_image.shape[1]
            else:
                width = opt_image.shape[2]
                height = opt_image.shape[1]

        if (opt_image is None) or (opt_image_encode == False):
            latent_width = width // 8
            latent_height = height // 8
            samples = torch.zeros([batch_size, 4, latent_height, latent_width], device=comfy.model_management.intermediate_device())
            width = latent_width * 8
            height = latent_height * 8
            latent = {"samples":samples}
        else:
            from nodes import VAEEncode # the nodes module can be referenced, because its path is added to sys.path in __init__
            (latent, ) = VAEEncode().encode(vae, opt_image, )
            if batch_size > 1:
                from nodes import RepeatLatentBatch # the nodes module can be referenced, because its path is added to sys.path in __init__
                (latent, ) = RepeatLatentBatch().repeat(latent, batch_size, )

        return io.NodeOutput(width, height, batch_size, latent, opt_image)


class CollectModelNtxdata(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}CollectModelNtxdata",
            display_name=f"{ADDON_PREFIX} Collect Model Ntxdata",
            description="",
            category=f"{ADDON_CATEGORY}/utils",
            is_output_node=True,
            inputs=[
                io.AnyType.Input("ckpt_name", optional=True),
                LORA_STACK_TYPE.Input("lora_stack", optional=True),
            ],
            outputs=[],
        )

    @classmethod
    def execute(cls, ckpt_name=None, lora_stack=None):

        models_list = []

        if ckpt_name is not None:
            models_list.append(folder_paths.get_full_path_or_raise("checkpoints", ckpt_name))

        if lora_stack is not None:
            for (lora_name, _, _) in lora_stack:
                models_list.append(folder_paths.get_full_path_or_raise("loras", lora_name))

        download_dir = SETTINGS_DIR / "downloads"
        download_dir.mkdir(parents=True, exist_ok=True)
        log_info(f"Copy to {download_dir}")

        for model_name in models_list:
            model_path = Path(model_name)
            datafile_path = model_path.with_suffix('.ntxdata')
            if datafile_path.is_file():
                shutil.copy(datafile_path, download_dir / datafile_path.name)
                log_info(f"- copied {datafile_path}")
            else:
                log_warning(f"- not found! {model_name}")

        return io.NodeOutput()


class PromptChainer(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}PromptChainer",
            display_name=f"{ADDON_PREFIX} Prompt Chainer",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.String.Input("prompt", multiline=True, dynamic_prompts=True, default=""),
                io.String.Input("prev_prompt", multiline=True, dynamic_prompts=True, default="",
                                optional=True, force_input=True),
            ],
            outputs=[
                io.String.Output("prompt"),
            ],
        )

    @classmethod
    def execute(cls, prompt, prev_prompt=None):
        if prev_prompt is None:
            return io.NodeOutput(prompt)
        else:
            return io.NodeOutput(prev_prompt + "\n" + prompt)


class CLIPTextEncodeWithCutoff(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=f"{ADDON_PREFIX}CLIPTextEncodeWithCutoff",
            display_name=f"{ADDON_PREFIX} CLIPTextEncodeWithCutoff",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input("prompt",
                    default="",
                    multiline=True
                ),
            ],
            outputs=[
                io.Conditioning.Output("conditioning")
            ]
        )

    @classmethod
    def execute(cls, clip, prompt) -> io.NodeOutput:
        from nodes import CLIPTextEncode, ConditioningConcat

        if "BREAK" in prompt:
            prompts = prompt.split("BREAK")
            print(f"Conditioning 0 : {prompts[0]}")
            (conditioning,) = CLIPTextEncode().encode(clip=clip, text=prompts[0])
            for i in range(1,len(prompts)):
                print(f"Conditioning {i} : {prompts[i]}")
                (conditioning_to,) = CLIPTextEncode().encode(clip=clip, text=prompts[i])
                (conditioning,) = ConditioningConcat().concat(conditioning_to=conditioning_to, conditioning_from=conditioning)
            return io.NodeOutput(conditioning)
        else:
            print(f"Conditioning all : {prompt}")
            (conditioning,) = CLIPTextEncode().encode(clip=clip, text=prompt)
            return io.NodeOutput(conditioning)


class Test(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}Test",
            display_name=f"{ADDON_PREFIX} Test",
            description="",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                LORA_STACK_TYPE.Input("lora_stack"),
            ],
            outputs=[
                LORA_STACK_TYPE.Output("lora_stack"),
            ],
        )

    @classmethod
    def execute(cls, lora_stack):
        return io.NodeOutput(lora_stack)


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        ReplaceTextParameters,
        SwitchAny,
        LoadCustomVae,
        LoraStack,
        MergeLoraStacks,
        ApplyLoraStack,
        ConvertLoraStackToString,
        ConvertLoraStringToStack,
        CreateImageLatent,
        CollectModelNtxdata,
        PromptChainer,
        #CLIPTextEncodeWithCutoff,
        #Test,
    ]
