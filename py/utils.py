from comfy_api.latest import ComfyExtension, io

import comfy.samplers
import folder_paths

import os
import re
from pathlib import Path

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, SETTINGS_DIR
from .logging import logger

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
