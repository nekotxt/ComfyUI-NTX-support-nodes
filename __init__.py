import re

ADDON_PREFIX = "NTX"
ADDON_CATEGORY = "NTXUtils"

# ===== UTILITIES ========================================================================================================================

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

class AnyType(str):
    """A special type that can be connected to any other types. Credit to pythongosssss"""
    def __ne__(self, __value: object) -> bool:
        return False

ANY_TYPE = AnyType("*")

# ===== NODES : DICTIONARY ===============================================================================================================

class DictSetMulti:
    def __init__(self):
        pass

    NUMBER_OF_PARAMETERS = 1

    @classmethod
    def INPUT_TYPES(cls):
        parameters = {
            "required": {
            },
            "optional": {
                "pipe": ("DICT", )
            }
        }
        if cls.NUMBER_OF_PARAMETERS == 1:
            parameters["required"][f"key"] = ("STRING", {"default": ""})
            parameters["optional"][f"value"] = (ANY_TYPE, {"default": ""})
        else:
            for i in range(1,cls.NUMBER_OF_PARAMETERS+1):
                parameters["required"][f"key{i}"] = ("STRING", {"default": ""})
                parameters["optional"][f"value{i}"] = (ANY_TYPE, {"default": ""})
        return parameters

    RETURN_TYPES = ("DICT", )
    RETURN_NAMES = ("pipe", )

    FUNCTION = "pack"
    CATEGORY = "pipe"
    DESCRIPTION = "Dictionary set"

    OUTPUT_NODE = False

    def pack(self, **kwargs, ):

        pipe = kwargs.get("pipe")
        pipe = {} if pipe == None else clone_data(pipe)
        if self.__class__.NUMBER_OF_PARAMETERS == 1:
            key = kwargs.get("key")
            value = kwargs.get("value")
            if value == None:
                if key in pipe:
                    del pipe[key]
            else:
                pipe[key] = value
        else:
            for i in range(1,self.__class__.NUMBER_OF_PARAMETERS+1):
                key = kwargs.get(f"key{i}")
                value = kwargs.get(f"value{i}")
                if value == None:
                    if key in pipe:
                        del pipe[key]
                else:
                    pipe[key] = value
        return (pipe, )

class DictSet1(DictSetMulti):
    def __init__(self):
        pass

    NUMBER_OF_PARAMETERS = 1

class DictSet5(DictSetMulti):
    def __init__(self):
        pass

    NUMBER_OF_PARAMETERS = 5

class DictSet10(DictSetMulti):
    def __init__(self):
        pass

    NUMBER_OF_PARAMETERS = 10

class DictSet:
    def __init__(self):
        pass

    DATA_TYPE = ANY_TYPE
    DEFAULT_VALUE = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "key": ("STRING", {"default": ""})
            },
            "optional": {
                "pipe": ("DICT", ),
                "value": (cls.DATA_TYPE, {"default": cls.DEFAULT_VALUE})
            }
        }

    RETURN_TYPES = ("DICT", )
    RETURN_NAMES = ("pipe", )

    FUNCTION = "pack"
    CATEGORY = "pipe"
    DESCRIPTION = "Dictionary set"

    OUTPUT_NODE = False

    def pack(self, key, pipe=None, value=None ):

        if key == "":
            return (pipe, )
        if value == None:
            return (pipe, )

        pipe = {} if pipe == None else clone_data(pipe)
        pipe[key] = value

        return (pipe, )
class DictGet:
    def __init__(self):
        pass

    DATA_TYPE = ANY_TYPE
    DEFAULT_VALUE = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pipe": ("DICT", ),
                "key": ("STRING", {"default": ""}),
            },
            "optional": {
                "default": (cls.DATA_TYPE, {"default": cls.DEFAULT_VALUE})
            },
        }

    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", "value" , )

    FUNCTION = "unpack"
    CATEGORY = "pipe"
    DESCRIPTION = "Dictionary get"

    OUTPUT_NODE = False

    def unpack(self, pipe, key, default=None):

        if default == None:
            default = self.__class__.DEFAULT_VALUE

        return (pipe, pipe.get(key, default), )

class DictSetBoolean(DictSet):
    DATA_TYPE = "BOOLEAN"
    DEFAULT_VALUE = False
class DictGetBoolean(DictGet):
    DATA_TYPE = "BOOLEAN"
    DEFAULT_VALUE = False
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetFloat(DictSet):
    DATA_TYPE = "FLOAT"
    DEFAULT_VALUE = 0.0
class DictGetFloat(DictGet):
    DATA_TYPE = "FLOAT"
    DEFAULT_VALUE = 0.0
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetInt(DictSet):
    DATA_TYPE = "INT"
    DEFAULT_VALUE = 0
class DictGetInt(DictGet):
    DATA_TYPE = "INT"
    DEFAULT_VALUE = 0
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetString(DictSet):
    DATA_TYPE = "STRING"
    DEFAULT_VALUE = ""
class DictGetString(DictGet):
    DATA_TYPE = "STRING"
    DEFAULT_VALUE = ""
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetModel(DictSet):
    DATA_TYPE = "MODEL"
    DEFAULT_VALUE = None
class DictGetModel(DictGet):
    DATA_TYPE = "MODEL"
    DEFAULT_VALUE = None
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetClip(DictSet):
    DATA_TYPE = "CLIP"
    DEFAULT_VALUE = None
class DictGetClip(DictGet):
    DATA_TYPE = "CLIP"
    DEFAULT_VALUE = None
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetVae(DictSet):
    DATA_TYPE = "VAE"
    DEFAULT_VALUE = None
class DictGetVae(DictGet):
    DATA_TYPE = "VAE"
    DEFAULT_VALUE = None
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetLoraStack(DictSet):
    DATA_TYPE = "LORA_STACK"
    DEFAULT_VALUE = []
class DictGetLoraStack(DictGet):
    DATA_TYPE = "LORA_STACK"
    DEFAULT_VALUE = []
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetControlNetStack(DictSet):
    DATA_TYPE = "CONTROL_NET_STACK"
    DEFAULT_VALUE = []
class DictGetControlNetStack(DictGet):
    DATA_TYPE = "CONTROL_NET_STACK"
    DEFAULT_VALUE = []
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetConditioning(DictSet):
    DATA_TYPE = "CONDITIONING"
    DEFAULT_VALUE = None
class DictGetConditioning(DictGet):
    DATA_TYPE = "CONDITIONING"
    DEFAULT_VALUE = None
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetLatent(DictSet):
    DATA_TYPE = "LATENT"
    DEFAULT_VALUE = None
class DictGetLatent(DictGet):
    DATA_TYPE = "LATENT"
    DEFAULT_VALUE = None
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetImage(DictSet):
    DATA_TYPE = "IMAGE"
    DEFAULT_VALUE = None
class DictGetImage(DictGet):
    DATA_TYPE = "IMAGE"
    DEFAULT_VALUE = None
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

class DictSetDict(DictSet):
    DATA_TYPE = "DICT"
    DEFAULT_VALUE = {}
class DictGetDict(DictGet):
    DATA_TYPE = "DICT"
    DEFAULT_VALUE = {}
    RETURN_TYPES = ("DICT", DATA_TYPE, )
    RETURN_NAMES = ("pipe", DATA_TYPE, )

# ===== NODES : LIST =====================================================================================================================

class ListSet:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
            },
            "optional": {
                "items": ("LIST", ),
                "value": (ANY_TYPE, {"default": ""})
            },
        }

    RETURN_TYPES = ("LIST" , )
    RETURN_NAMES = ("items", )

    FUNCTION = "pack"
    CATEGORY = "pipe"
    DESCRIPTION = "List set"

    OUTPUT_NODE = False

    def pack(self, items=None, value=None, ):

        items = [] if items == None else clone_data(items)
        items.append(value)
        return (items, )

class ListCount:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "items": ("LIST", ),
            },
            "optional": {
            },
        }

    RETURN_TYPES = ("LIST" , "INTEGER", )
    RETURN_NAMES = ("items", "count"  , )

    FUNCTION = "unpack"
    CATEGORY = "pipe"
    DESCRIPTION = "List count"

    OUTPUT_NODE = False

    def unpack(self, items, ):

        return (items, len(items), )

class ListGet:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "items": ("LIST", ),
                "index": ("INT", {"default": 0}),
            },
            "optional": {
            },
        }

    RETURN_TYPES = ("LIST" , ANY_TYPE, )
    RETURN_NAMES = ("items", "value" , )

    FUNCTION = "unpack"
    CATEGORY = "pipe"
    DESCRIPTION = "List get"

    OUTPUT_NODE = False

    def unpack(self, items, index, ):

        return (items, items[index], )

# ===== NODES : UTILITIES ==================================================================================================================

class ReplaceTextParameters:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "parameters": ("DICT", ),
                "text": ("STRING", {"default": ""})
            },
            "optional": {
            }
        }

    RETURN_TYPES = ("STRING", )
    RETURN_NAMES = ("text", )

    FUNCTION = "parse"
    CATEGORY = "utils"
    DESCRIPTION = "Replace text parameters"

    OUTPUT_NODE = False

    def parse(self, parameters, text ):

        if parameters != None:
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
    DESCRIPTION = "Return the first non-null input"

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

# ===== INITIALIZATION =====================================================================================================================

NODE_LIST = {
    "DictSet1": DictSet1,
    "DictSet5": DictSet5,
    "DictSet10": DictSet10,

    "DictSet": DictSet,
    "DictGet": DictGet, 

    "DictSetBoolean": DictSetBoolean,
    "DictGetBoolean": DictGetBoolean,

    "DictSetFloat": DictSetFloat,
    "DictGetFloat": DictGetFloat,

    "DictSetInt": DictSetInt,
    "DictGetInt": DictGetInt,

    "DictSetString": DictSetString,
    "DictGetString": DictGetString,

    "DictSetModel": DictSetModel,
    "DictGetModel": DictGetModel,

    "DictSetClip": DictSetClip,
    "DictGetClip": DictGetClip,

    "DictSetVae": DictSetVae,
    "DictGetVae": DictGetVae,

    "DictSetLoraStack": DictSetLoraStack,
    "DictGetLoraStack": DictGetLoraStack,

    "DictSetControlNetStack": DictSetControlNetStack,
    "DictGetControlNetStack": DictGetControlNetStack,

    "DictSetConditioning": DictSetConditioning,
    "DictGetConditioning": DictGetConditioning,

    "DictSetLatent": DictSetLatent,
    "DictGetLatent": DictGetLatent,

    "DictSetImage": DictSetImage,
    "DictGetImage": DictGetImage,

    "DictSetDict": DictSetDict,
    "DictGetDict": DictGetDict,
    
    "ListSet": ListSet,
    "ListCount": ListCount,
    "ListGet": ListGet,

    "ReplaceTextParameters": ReplaceTextParameters,
    "SwitchAny": SwitchAny
}

def generate_node_mappings(node_config):
    node_class_mappings = {}
    node_display_name_mappings = {}

    for node_name, node_class in node_config.items():
        full_name = f"{ADDON_PREFIX}{node_name}"
        node_class_mappings[full_name] = node_class
        node_display_name_mappings[full_name] = full_name
        if is_string_empty(node_class.CATEGORY):
            node_class.CATEGORY = ADDON_CATEGORY
        else:
            node_class.CATEGORY = f"{ADDON_CATEGORY}/{node_class.CATEGORY}"

    return node_class_mappings, node_display_name_mappings

NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = generate_node_mappings(NODE_LIST)
