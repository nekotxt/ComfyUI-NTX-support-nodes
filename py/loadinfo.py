import json

from pathlib import Path

from .utils import clone_data

SETTINGS_DIR = Path.cwd() / "input" / "ntx_data"

# ===== LOAD CHARACTER DEFINITIONS ===============================================================================================

characters_file = SETTINGS_DIR / "characters.json"
if characters_file.is_file():
    with open(characters_file,'r', encoding='utf-8') as f:
        CHARS_DATA = json.load(f)
    CHARS_LIST_OF_NAMES = list(CHARS_DATA.keys())
    CHARS_LIST_OF_OPTIONS = []
    for chardata in CHARS_DATA.values():
        for name in chardata.keys():
            if not name in CHARS_LIST_OF_OPTIONS:
                CHARS_LIST_OF_OPTIONS.append(name)
else:
    CHARS_DATA = {}
    CHARS_LIST_OF_NAMES = []
    CHARS_LIST_OF_OPTIONS = []
    
class LoadCharInfo:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        global g_character_prompts
        return {
            "required": {
                "name": (CHARS_LIST_OF_NAMES,),
                "option": (CHARS_LIST_OF_OPTIONS,),
                "char": ("STRING", {
                    "multiline": True, #True if you want the field to look like the one on the ClipTextEncode node
                    "dynamicPrompts": True,
                    "default": ""
                }),
                "save_name": ("STRING", {
                    "multiline": False, #True if you want the field to look like the one on the ClipTextEncode node
                    "dynamicPrompts": False,
                    "default": ""
                }),
            },
            "optional": {
                "parameters": ("DICT", ),
            },
        }

    RETURN_TYPES = ("DICT"      , "STRING", "STRING"   , )
    RETURN_NAMES = ("parameters", "char"  , "save_name", )

    FUNCTION = "execute"

    #OUTPUT_NODE = False

    CATEGORY = "loadinfo"

    def execute(self, name, option, char, save_name, parameters = {}, ):   

        parameters = clone_data(parameters)

        parameters["char"] = char
        parameters["save_name"] = save_name

        return (parameters, char, save_name, )

def get_options_for_char(char_name):
    return list(CHARS_DATA.get(char_name, {}).keys())

def get_prompt_for_char_option(char_name, option_name):
    return CHARS_DATA.get(char_name, {}).get(option_name, "")

# ===== INITIALIZATION =====================================================================================================================

NODE_LIST = {
    "LoadCharInfo": LoadCharInfo,
}
