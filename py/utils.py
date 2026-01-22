import comfy.samplers
import comfy.sd
import comfy.utils
import folder_paths

import os
import re
import torch
from pathlib import Path

from .logging import log_info, log_warning

SETTINGS_DIR = Path.cwd() / "input" / "ntx_data"

MAX_CACHED_LORAS = 5

def util_setup(max_cached_loras:int):
    global MAX_CACHED_LORAS

    MAX_CACHED_LORAS = max_cached_loras
    log_info(f"MAX_CACHED_LORAS = {MAX_CACHED_LORAS}")

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
            if k in base and base[k] != None:
                dict_merge(base[k], v)
            else:
                base[k] = clone_data(v)
        elif type(v) is list:
            if k in base and base[k] != None:
                for entry in v:
                    base[k].append(clone_data(entry))
            else:
                base[k] = clone_data(v)
        else:
            base[k] = clone_data(v)

# utility for cleaning path names
def clean_path(path:str):
    return path.replace("\\", os.path.sep).replace("/", os.path.sep)

# ===== AnyType CLASS ==================================================================================================================

class AnyType(str):
    """A special type that can be connected to any other types. Credit to pythongosssss"""
    def __ne__(self, __value: object) -> bool:
        return False

ANY_TYPE = AnyType("*")

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

# ===== NODES : UTILITIES ==================================================================================================================

class ReplaceTextParameters:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": ""})
            },
            "optional": {
                "parameters": ("DICT", ),
            }
        }

    RETURN_TYPES = ("STRING", )
    RETURN_NAMES = ("text", )

    FUNCTION = "parse"
    CATEGORY = "utils"
    DESCRIPTION = """
    Replace text parameters.
    The parameters must be in the form '%%name%%'
    For instance, if text='in the style of %%artist%%'
    and parameters contains an entry 'artist': 'anime'
    then the returned text will be 'in the style of anime'
    If the parameter name is not found in the dictionary, it will be replaced with an empty string.
    """

    OUTPUT_NODE = False

    def parse(self, text, parameters=None ):

        if parameters == None:
            parameters = {}

        pattern = r'%%([^%]+)%%'
        matches = re.findall(pattern, text)
        for match in matches:
            text = text.replace(f"%%{match}%%", parameters.get(match, ""))

        return (text, )

class SwitchAny:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
            },
            "optional": {
                "input1": (ANY_TYPE,),
                "input2": (ANY_TYPE,),
                "input3": (ANY_TYPE,),
                "input4": (ANY_TYPE,),
                "input5": (ANY_TYPE,),
            },
        }

    RETURN_TYPES = (ANY_TYPE, )
    RETURN_NAMES = ("output", )

    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = "Return the first non-null input, or None if all inputs are missing"

    OUTPUT_NODE = False

    def execute(self, input1 = None, input2 = None, input3 = None, input4 = None, input5 = None):        
        if input1 != None:
            return (input1, )
        if input2 != None:
            return (input2, )
        if input3 != None:
            return (input3, )
        if input4 != None:
            return (input4, )
        return (input5, )

class LoadCustomVae:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "use_custom_vae": ("BOOLEAN", {
                    "default": True, 
                    "label_on": "yes", 
                    "label_off": "no", 
                    "tooltip": "if yes, load and pass the specified VAE, instead of the input value"
                }),                
                "vae_name": (load_list_vaes(), ),
            },
            "optional": {
                "vae": ("VAE",),
            },
        }

    RETURN_TYPES = ("VAE", "STRING"  , )
    RETURN_NAMES = ("vae", "vae_name", )

    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = "If the flag is set to True, load the specified vae"

    OUTPUT_NODE = False

    def execute(self, use_custom_vae, vae_name, vae = None):        

        if use_custom_vae:
            from nodes import VAELoader # the nodes module can be referenced, because its path is added to sys.path in __init__
            (vae, ) = VAELoader().load_vae(vae_name)
        else:
            vae_name = ""

        return (vae, vae_name, )

class ConvertLoraStackToString:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
            },
            "optional": {
                "lora_stack": ("LORA_STACK",),
            },
        }

    RETURN_TYPES = ("STRING"    , )
    RETURN_NAMES = ("stack_text", )

    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = "Convert a list of LoRAs into a string"

    OUTPUT_NODE = False

    def execute(self, lora_stack = None):        

        text = ""

        if lora_stack != None:
            for lora_def in lora_stack:
                if len(lora_def) >= 3:
                    text += format_lora_as_string(lora_def[0], lora_def[1], lora_def[2]) + "\n"
                elif len(lora_def) >= 2:
                    text += format_lora_as_string(lora_def[0], lora_def[1], lora_def[1]) + "\n"
                elif len(lora_def) >= 1:
                    text += format_lora_as_string(lora_def[0], 1.0, 1.0) + "\n"

        return (text, )
 
class ConvertLoraStringToStack:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {
                    "multiline": False,
                    "dynamicPrompts": False,
                    "default": ""
                }),
            },
            "optional": {
                "initial_lora_stack": ("LORA_STACK",),
            },
        }

    RETURN_TYPES = ("STRING",       "LORA_STACK"      , )
    RETURN_NAMES = ("clean_prompt", "final_lora_stack", )

    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = "Parse a text prompt and convert the LoRA references to a stack"

    OUTPUT_NODE = False

    def execute(self, prompt, initial_lora_stack=None):        

        if initial_lora_stack == None:
            initial_lora_stack = []
        
        final_lora_stack = initial_lora_stack + extract_lora_strings(prompt)

        clean_prompt = remove_text_between_angle_brackets(prompt)

        return (clean_prompt, final_lora_stack, )

image_sizes_file = SETTINGS_DIR / "image_sizes.txt"
if image_sizes_file.is_file():
    IMAGE_SIZES = image_sizes_file.read_text(encoding="utf-8").splitlines()
else:
    IMAGE_SIZES = ["512x512", "512x768", "768x512", "832x1216", "1216x832", "896x1152", "1152x896", "1024x1024", "1024x1536", "1536x1024"]
class CreateImageLatent:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image_size": (
                    ["custom"] + IMAGE_SIZES,
                    {
                        "default": "custom"
                    }
                ),
                "width": (
                    "INT",
                    {
                        "default": 0, 
                        "min": 0, 
                        "max": 4096, 
                        "step": 1
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 0, 
                        "min": 0, 
                        "max": 4096, 
                        "step": 1
                    },
                ),
                "batch_size": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 24,
                    },
                ),
            },
            "optional": {
                "opt_image": ("IMAGE", ),
                "vae": ("VAE", ),
            },
        }

    RETURN_TYPES = ("INT"  , "INT"   , "INT"       , "LATENT", "IMAGE"    , )
    RETURN_NAMES = ("width", "height", "batch_size", "latent", "opt_image", ) 

    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = """Build the latents from the specified image size. If an image is provided, its size will be used.
                    To customize the list of image sizes, create a file /input/ntx_data/image_sizes.txt
                    and write the sizes, one for each row, int the form WIDTHxHEIGHT"""

    OUTPUT_NODE = False

    def execute(self, image_size, width, height, batch_size, opt_image=None, vae=None):        

        if opt_image == None:
            if image_size != "custom": # decode standard image size if any
                match = re.search(r'([\d]+)x([\d]+)', image_size)
                if match == None:
                    width = 512
                    height = 512
                else:
                    width = int(match[1])
                    height = int(match[2])
            
            latent_width = width // 8
            latent_height = height // 8
            samples = torch.zeros([batch_size, 4, latent_height, latent_width], device=comfy.model_management.intermediate_device())
            width = latent_width * 8
            height = latent_height * 8
            
            latent = {"samples":samples}
            
            return (width, height, batch_size, latent, None, )
        else:
            width = opt_image.shape[2]
            height = opt_image.shape[1]
            from nodes import VAEEncode # the nodes module can be referenced, because its path is added to sys.path in __init__
            (latent, ) = VAEEncode().encode(vae, opt_image, )
            return (width, height, 1, latent, opt_image, )

CACHED_LORAS = []
class ApplyLoraStack:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "lora_stack" :("LORA_STACK", ),
                "model": ("MODEL", ),
            },
            "optional": {
                "clip": ("CLIP", ),
            },
        }

    RETURN_TYPES = ("LORA_STACK", "MODEL"  , "CLIP", )
    RETURN_NAMES = ("lora_stack", "model"  , "clip", ) 

    FUNCTION = "execute"
    CATEGORY = "utils"
    DESCRIPTION = "Apply lora stack to model and (optionally) clip"

    OUTPUT_NODE = False

    def execute(self, lora_stack, model, clip=None, ):        

        global CACHED_LORAS
        global MAX_CACHED_LORAS

        if(lora_stack == None):
            return (lora_stack, model, clip, )
            
        if(len(lora_stack) == 0):
            return (lora_stack, model, clip, )
        
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

            try:
                lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)

                lora = None
                for(cached_lora_path, cached_lora) in CACHED_LORAS:
                    if cached_lora_path == lora_path:
                        lora = cached_lora
                        break

                if lora == None:
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

        return (applied_lora_stack, model, clip, )


# ===== INITIALIZATION =====================================================================================================================

NODE_LIST = {
    "ReplaceTextParameters": ReplaceTextParameters,
    "SwitchAny": SwitchAny,
    "LoadCustomVae": LoadCustomVae,
    "ConvertLoraStackToString": ConvertLoraStackToString,
    "ConvertLoraStringToStack": ConvertLoraStringToStack,
    "CreateImageLatent": CreateImageLatent,
    "ApplyLoraStack": ApplyLoraStack,
}
