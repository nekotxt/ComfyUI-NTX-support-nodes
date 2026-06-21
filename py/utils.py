from comfy_api.latest import ComfyExtension, io

import comfy.samplers
import comfy.utils
import folder_paths

import os
import re
import subprocess
from pathlib import Path

from ..config_variables import ADDON_NAME, ADDON_PREFIX, API_PREFIX, ADDON_CATEGORY, SETTINGS_DIR
from .logging import logger

from server import PromptServer

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

# ===== FRONTEND MESSAGING =========================================================================================================================

def notify_user(severity, summary, detail):
    """Best-effort toast on the frontend (see web/js listener); never fatal."""
    try:
        PromptServer.instance.send_sync(
            f"{API_PREFIX}.toast",
            {"severity": severity, "summary": summary, "detail": detail},
        )
    except Exception:
        pass

# ===== FILE DOWNLOAD =========================================================================================================================

def download_file_from_cloud(cloud_storage_id:str, model_subpath: Path, save_path: Path) -> (bool, str):
    """Download from cloud storage using rclone"""
    cloud_path = f"{cloud_storage_id}:models/{model_subpath}"
    try:
        result = subprocess.run(
            ["rclone", "copy", cloud_path, str(save_path.parent), "-P"],
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes
        )
        # Check return code, not just stderr
        if result.returncode == 0 and save_path.exists():
            return (True, "Downloaded from cloud storage successfully")
        else:
            return (False, f"Cloud download failed: {result.stderr}")
    except subprocess.TimeoutExpired:
        return (False, "Cloud download timed out")
    except FileNotFoundError:
        return (False, "rclone not found in PATH")
    except Exception as e:
        return (False, f"Cloud download error: {e}")

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

# ===== UTILITY FUNCTIONS FOR IMAGES ======================================================================================================

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

def image_crop(image, width:int, height:int, rescaler:str="lanczos", crop_position:str="center"):
    final_image = comfy.utils.common_upscale(image.movedim(-1, 1), width, height, rescaler, crop_position).movedim(1, -1)
    return final_image

def image_rescale_keeping_aspect_ratio(image, width:int, height:int, rescaler:str="lanczos"):
    image_w = image.shape[2]
    image_h = image.shape[1]

    ratio_w = width / image_w
    ratio_h = height / image_h
    if ratio_w < ratio_h:
        final_width = width
        final_height = round(image_h * ratio_w)
    else:
        final_width = round(image_w * ratio_h)
        final_height = height

    final_image = comfy.utils.common_upscale(image.movedim(-1, 1), final_width, final_height, rescaler, "disabled").movedim(1, -1)
    #width = image.shape[2]
    #height = image.shape[1]

    return final_image

# ===== RETRIVE ACTUAL POSITION OF A MODEL =================================================================================================

LIST_OF_MODEL_DIRS = {}
def find_model_file(model_type:str, model_name:str, look_in_all_dirs:bool=True):
    model_name = clean_path(model_name)

    # first try : look for the model in the exact position specified by caller
    model_path = ""
    try:
        model_path = folder_paths.get_full_path_or_raise(model_type, model_name)
        # logger.info(f"- found [{model_name}] => {model_path}")
        return (model_name, model_path)
    except Exception as e:
        logger.info(f"- {e}")

    # if specified by caller, try to find the file name in all configured dirs
    if look_in_all_dirs:

        # generate the list of candidate dirs, if needed
        # this is a list of all dirs defined in ComfyUI including all subdirs
        global LIST_OF_MODEL_DIRS
        if not model_type in LIST_OF_MODEL_DIRS:
            logger.info(f"* Retrieve list of {model_type} dirs defined in ComfyUI")
            list_of_dirs_for_model_type = []
            for model_dir in folder_paths.folder_names_and_paths.get(model_type, ([], []))[0]:
                for subdir in Path(model_dir).rglob("*"):
                    if subdir.is_dir():
                        list_of_dirs_for_model_type.append((model_dir, subdir))
            LIST_OF_MODEL_DIRS[model_type] = list_of_dirs_for_model_type

        # check if a file with the required name exists in one of the model dirs
        model_name_short = Path(model_name).name
        for (model_dir, subdir) in LIST_OF_MODEL_DIRS[model_type]:
            # logger.info(f"- try with dir:{subdir}")
            model_path = subdir / model_name_short
            if model_path.exists():
                model_path = str(model_path)
                model_name_found = model_path[len(model_dir)+1:]
                logger.info(f"- found [{model_name}] => [{model_name_found}] => {model_path}")
                return (model_name_found, model_path)

    # it could not find the model
    return (model_name, None)
