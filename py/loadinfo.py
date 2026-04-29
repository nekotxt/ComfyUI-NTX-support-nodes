from comfy_api.latest import ComfyExtension, io

from typing_extensions import override

import folder_paths

import json
import ruamel.yaml

from pathlib import Path

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, SETTINGS_DIR, MODEL_TYPES
from .logging import log_info, log_warning
from .utils import clone_data, clean_path, load_list_vaes, load_list_samplers, load_list_schedulers, DICT_TYPE

#SETTINGS_DIR = Path.cwd() / "input" / "ntx_data"
#MODEL_TYPES = ["vae", "checkpoints", "loras"]

# ===== LOAD MODELS FILE =========================================================================================================

def _get_full_model_id(model_type:str, model_id:str):
    return f"{model_type}@{clean_path(model_id)}"

class ModelsManager():
    def __init__(self):
        global SETTINGS_DIR
        self.models_file = SETTINGS_DIR / "catalogue_of_ntxdata.json"
        self.catalogue = {}
        self.models_by_ID = {}
        self.categories_list = []

    def load(self):
        global MODEL_TYPES

        if self.models_file.is_file():
            with open(self.models_file,'r', encoding='utf-8') as f:
                self.catalogue = json.load(f)
        else:
            self.catalogue = {}
        
        # ensure that all the IDs are aligned with the path separator used by the OS
        for model_type in MODEL_TYPES:
            for model_data in self.catalogue.get(model_type, []):
                model_data["id"] = clean_path(model_data.get("id", ""))

        models_by_ID = {}
        duplicates = 0
        # scan each model type (chekpoints, loras, vae ...)
        for model_type in MODEL_TYPES:
            for model_data in self.catalogue.get(model_type, []):
                model_id = model_data.get("id", "")
                if model_id != "":
                    # assign references to recover the data, and check for possible duplicates
                    # The model can be referenced as :
                    # - id   (FLUX/styles/vixon/fantasy.safetensors)
                    # - name (fantasy.safetensors)
                    # - stem (fantasy)
                    # The final full model id is in the form model_type@model_id (loras@FLUX/styles/vixon/fantasy.safetensors)
                    model_id_path = Path(model_id)
                    for identifier in [model_id, model_id_path.name, model_id_path.stem]:
                        full_model_id = _get_full_model_id(model_type, identifier)
                        if full_model_id in models_by_ID:
                            log_warning(f"- [{full_model_id}] duplicated (existing: [{models_by_ID[full_model_id]['id']}], new: [{model_data['id']}])")
                            duplicates = duplicates + 1
                        else:
                            models_by_ID[full_model_id] = model_data
        if duplicates > 0:
            log_warning(f"{duplicates} duplicates found")
        self.models_by_ID = models_by_ID

        categories_list = []
        for model_type in MODEL_TYPES:
            for model_data in self.catalogue.get(model_type, []):
                # the first token of model_id is assumed to be the model base type, e.g. :
                # FLUX => (empty)
                # FLUX\styles => styles
                # FLUX\styles\vixon => styles.vixon
                model_id = model_data.get("id", "") # e.g. FLUX\styles\vixon\fantasy.safetensors
                parent_subdir = str(Path(model_id).parent) # e.g. FLUX\styles\vixon
                parent_subdir = parent_subdir.replace("\\", ".").replace("/", ".") # e.g. FLUX.styles.vixon
                parts = parent_subdir.split('.', 1) # the 1 means that only the first . will be considered, so the result has either 1 or 2 entries  e.g. FLUX
                category = parts[1] if (len(parts)>1) else ""
                if not (category in categories_list):
                    categories_list.append(category)
        self.categories_list = categories_list

    def get_model(self, model_type:str, model_id:str):
        full_model_id = _get_full_model_id(model_type, model_id)
        return self.models_by_ID.get(full_model_id, None)

    def get_models_list(self, model_type:str):
        models_list = []
        if model_type in self.catalogue:
            for model_data in self.catalogue[model_type]:
                models_list.append(model_data.get("id", ""))
            models_list.sort()
        models_list = folder_paths.get_filename_list(model_type) + ["----- models from data file ----"] + models_list
        return models_list
        
    def get_model_categories_list(self):
        return self.categories_list
    
    def solve_model_id(self, model_type:str, model_id:str):
        # if the model is found, return the model id as defined in the model data, otherwise just return the value passed as input
        # e.g. FLUX\styles\vixon\fantasy.safetensors => return # FLUX\styles\vixon\fantasy.safetensors
        #      FLUX\styles\vixon\fantasy             => return # FLUX\styles\vixon\fantasy.safetensors
        model_id = clean_path(model_id)
        model_info = self.get_model(model_type, model_id)
        return model_id if model_info == None else model_info.get("id", model_id)

g_models_manager = ModelsManager()
g_models_manager.load()
log_info(f"Create g_models_manager from {g_models_manager.models_file}")

class LoadCheckpointInfo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadCheckpointInfo",
            display_name=f"{ADDON_PREFIX} Load Checkpoint Info",
            category=f"{ADDON_CATEGORY}/loadinfo",
            inputs=[
                io.Combo.Input("ckpt_name", options=g_models_manager.get_models_list("checkpoints")),
                io.Int.Input("clip_skip", default=-1, min=-100, max=0, step=1),
                io.Combo.Input("vae_name", options=["Baked VAE"] + load_list_vaes(), default="Baked VAE"),
                io.Int.Input("steps", default=20, min=1, max=100, step=1),
                io.Float.Input("cfg", default=1.0, min=0.0, max=20.0, step=0.1, round=0.1),
                io.Combo.Input("sampler_name", options=load_list_samplers()),
                io.Combo.Input("scheduler", options=load_list_schedulers()),
                io.String.Input("model_prompt_positive", multiline=False, dynamic_prompts=False, default=""),
                io.String.Input("model_prompt_negative", multiline=False, dynamic_prompts=False, default=""),
                io.String.Input("notes", multiline=True, dynamic_prompts=False, default=""),
            ],
            outputs=[
                io.AnyType.Output("ckpt_name"),
                io.Int.Output("clip_skip"),
                io.Boolean.Output("use_custom_vae"),
                io.AnyType.Output("vae_name"),
                io.Int.Output("steps"),
                io.Float.Output("cfg"),
                io.AnyType.Output("sampler_name"),
                io.AnyType.Output("scheduler"),
                io.String.Output("model_prompt_positive"),
                io.String.Output("model_prompt_negative"),
            ],
        )

    @classmethod
    def execute(cls, ckpt_name, clip_skip, vae_name, steps, cfg, sampler_name, scheduler, model_prompt_positive, model_prompt_negative, notes):
        use_custom_vae = (vae_name != "Baked VAE")
        return io.NodeOutput(ckpt_name, clip_skip, use_custom_vae, vae_name, steps, cfg, sampler_name, scheduler, model_prompt_positive, model_prompt_negative)

# ===== LOAD CHARACTER DEFINITIONS ===============================================================================================

class CharactersManager():
    def __init__(self):
        global SETTINGS_DIR
        self.models_file = SETTINGS_DIR / "catalogue_of_ntxdata.json"
        self.extra_chars_file = SETTINGS_DIR / "extra_chars.yaml"
        self.characters_file = SETTINGS_DIR / "characters.json"        

    def load(self):
        if self.characters_file.is_file():
            with open(self.characters_file,'r', encoding='utf-8') as f:
                self.CHARS_DATA = json.load(f)
            self.CHARS_LIST_OF_NAMES = list(self.CHARS_DATA.keys())
            self.CHARS_LIST_OF_OPTIONS = []
            for chardata in self.CHARS_DATA.values():
                for name in chardata.keys():
                    if not name in self.CHARS_LIST_OF_OPTIONS:
                        self.CHARS_LIST_OF_OPTIONS.append(name)
        else:
            self.CHARS_DATA = {}
            self.CHARS_LIST_OF_NAMES = []
            self.CHARS_LIST_OF_OPTIONS = []

    def get_char_names(self):
        return self.CHARS_LIST_OF_NAMES

    def get_all_char_options(self):
        return self.CHARS_LIST_OF_OPTIONS

    def get_options_for_char(self, char_name):
        return list(self.CHARS_DATA.get(char_name, {}).keys())

    def get_prompt_for_char_option(self, char_name, option_name):
        return self.CHARS_DATA.get(char_name, {}).get(option_name, "")

g_characters_manager = CharactersManager()
g_characters_manager.load()
log_info(f"Create g_characters_manager from {g_characters_manager.characters_file}")

class LoadCharInfo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadCharInfo",
            display_name=f"{ADDON_PREFIX} Load Char Info",
            category=f"{ADDON_CATEGORY}/loadinfo",
            inputs=[
                io.Combo.Input("name", options=g_characters_manager.get_char_names()),
                io.Combo.Input("option", options=g_characters_manager.get_all_char_options()),
                io.String.Input("char", multiline=True, dynamic_prompts=True, default=""),
                io.String.Input("save_name", multiline=False, dynamic_prompts=False, default=""),
                DICT_TYPE.Input("parameters", optional=True),
            ],
            outputs=[
                DICT_TYPE.Output("parameters"),
                io.String.Output("char"),
                io.String.Output("save_name"),
            ],
        )

    @classmethod
    def execute(cls, name, option, char, save_name, parameters=None):
        parameters = {} if parameters is None else clone_data(parameters)
        parameters["char"] = char
        parameters["save_name"] = save_name
        return io.NodeOutput(parameters, char, save_name)

class LoadCharacterInfo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LoadCharacterInfo",
            display_name=f"{ADDON_PREFIX} Load Character Info",
            category=f"{ADDON_CATEGORY}/loadinfo",
            inputs=[
                io.Combo.Input("name", options=g_characters_manager.get_char_names()),
                io.Combo.Input("option", options=g_characters_manager.get_all_char_options()),
                io.String.Input("char", multiline=True, dynamic_prompts=True, default=""),
                io.String.Input("save_name", multiline=False, dynamic_prompts=False, default=""),
            ],
            outputs=[
                io.String.Output("char"),
                io.String.Output("save_name"),
            ],
        )

    @classmethod
    def execute(cls, name, option, char, save_name):
        return io.NodeOutput(char, save_name)


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        LoadCheckpointInfo,
        LoadCharInfo,
        LoadCharacterInfo,
    ]


# ===== DEBUG ========================================================================================================================

# DEBUGFILE_MODELS = SETTINGS_DIR / "log_models.txt"
# with open(DEBUGFILE_MODELS, 'w', encoding='utf-8') as f:
#     f.write("MODELS\n")
#     for modelid in g_models_manager.models_by_ID:
#         f.write(modelid + "\n")
#     f.write("\n\nCATEGORIES\n")
#     for cat in g_models_manager.get_model_categories_list():
#         f.write(cat + "\n")

# DEBUGFILE_CHARACTERS = SETTINGS_DIR / "log_characters.txt"
# with open(DEBUGFILE_CHARACTERS, 'w', encoding='utf-8') as f:
#     for char in g_characters_manager.get_char_names():
#         f.write(char + " [ ")
#         for option in g_characters_manager.get_options_for_char(char):
#             f.write(option + " ")
#         f.write("]\n")
