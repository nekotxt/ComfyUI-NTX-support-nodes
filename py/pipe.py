from .utils import clone_data, dict_merge, ANY_TYPE

ADDON_PREFIX = "NTX"
ADDON_CATEGORY = "NTXUtils"

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

# ===== NODES : CONTEXT ==================================================================================================================

def pipe_get_parameters(list_of_parameters: dict, force_input:bool):
    parameters_dict = {}
    parameters_dict["pipe"] = tuple(["DICT"])
    for name, (type_name, options, default_value) in list_of_parameters.items():
        final_options = {"forceInput": force_input}
        if options != None:
            final_options.update(options)
        parameters_dict[name] = tuple([type_name, final_options])
    return { "required": {}, "optional": parameters_dict, }

def pipe_get_return_types(list_of_parameters: dict, include_inputs:bool):
    types_list = []
    types_list.append("DICT")
    if include_inputs:
        for name, (type_name, options, default_value) in list_of_parameters.items():
            types_list.append(type_name)
    return tuple(types_list)

def pipe_get_return_names(list_of_parameters: dict, include_inputs:bool):
    names_list = []
    names_list.append("pipe")
    if include_inputs:
        for name, (type_name, options, default_value) in list_of_parameters.items():
            names_list.append(name)
    return tuple(names_list)

class PipeBase:
    def __init__(self):
        pass

    LIST_OF_PARAMETERS = {}
    INPUT_TYPES_DICT = {"required": {}, "optional": {},}

    @classmethod
    def INPUT_TYPES(cls):
        return cls.INPUT_TYPES_DICT

    RETURN_TYPES = tuple([])
    RETURN_NAMES = tuple([])

    FUNCTION = "pack"
    CATEGORY = "pipe"
    DESCRIPTION = "Context"

    OUTPUT_NODE = False

    def pack(self, **kwargs, ):

        pipe = kwargs.get("pipe", None)
        pipe = {} if pipe == None else clone_data(pipe)

        self.preprocess_arguments(pipe, kwargs)
        
        return_values = []
        return_values.append(pipe)

        #print(f"Class {self.__class__.__name__} :")

        #print("assign input values")
        for k,v in kwargs.items():
            if k == "pipe":
                #print(f"- pipe (skip)")
                continue
            if v != None:
                pipe[k] = v
                #print(f"- {k} = {v}")

        #print("recover output values")
        for name, (type_name, options, default_value) in self.__class__.LIST_OF_PARAMETERS.items():
            #print(f"- {name}")
            #print(f"  default_value {default_value}")
            retrieved_value = pipe.get(name, default_value)
            #print(f"  retrieved_value {retrieved_value}")
            return_values.append(retrieved_value)
            #print(tuple(return_values))
        
        return tuple(return_values)
    
    def preprocess_arguments(self, pipe, kwargs):
        pass

class PipeImageEdit(PipeBase):
    LIST_OF_PARAMETERS = {
        "model_name"        : (ANY_TYPE           , None                                                                , None),
        "clip_name"         : (ANY_TYPE           , None                                                                , None),
        "vae_name"          : (ANY_TYPE           , None                                                                , None),
        
        "shift"             : ("FLOAT"            , {"default": 3.0, "min": 0.0, "max": 20.0, "step":0.1, "round": 0.1,}, 3.0),
        "clip_skip"         : ("INT"              , {"default": -1, "min": -100, "max": 0, "step": 1,}                  , -1),

        "model"             : ("MODEL"            , None                                                                , None),
        "clip"              : ("CLIP"             , None                                                                , None),
        "vae"               : ("VAE"              , None                                                                , None),

        "prompt_positive"   : ("STRING"           , {"default": "" }                                                    , ""),
        "prompt_negative"   : ("STRING"           , {"default": "" }                                                    , ""),
        "text_parameters"   : ("DICT"             , None                                                                , {}),
        "positive"          : ("CONDITIONING"     , None                                                                , None),
        "negative"          : ("CONDITIONING"     , None                                                                , None),

        "width"             : ("INT"              , {"default": 0, "min": 128, "max": 4096, "step": 2,}                 , 0),
        "height"            : ("INT"              , {"default": 0, "min": 128, "max": 4096, "step": 2,}                 , 0),
        "batch_size"        : ("INT"              , {"default": 1, "min": 1, "max": 100, "step": 1,}                    , 1),
        "latent"            : ("LATENT"           , None                                                                , None),
        "images"            : ("IMAGE"            , None                                                                , None),

        "seed"              : ("INT"              , {"default": 0, "min": -1, "max": 10000000000, "step": 1,}           , 0),
        "steps"             : ("INT"              , {"default": 20, "min": 1, "max": 100, "step": 1,}                   , 20),
        "cfg"               : ("FLOAT"            , {"default": 1.0, "min": 0.0, "max": 20.0, "step":0.1, "round": 0.1,}, 1.0),
        "sampler_name"      : (ANY_TYPE           , None                                                                , "euler_ancestral"),
        "scheduler"         : (ANY_TYPE           , None                                                                , "simple"),

        "lora_stack"        : ("LORA_STACK"       , None                                                                , []),
        "control_net_stack" : ("CONTROL_NET_STACK", None                                                                , []),
    }
    INPUT_TYPES_DICT = pipe_get_parameters(LIST_OF_PARAMETERS, True)
    RETURN_TYPES = pipe_get_return_types(LIST_OF_PARAMETERS, True)
    RETURN_NAMES = pipe_get_return_names(LIST_OF_PARAMETERS, True)
    DESCRIPTION = "Pipe for image generation"
    
    def preprocess_arguments(self, pipe, kwargs):
        print("PipeImageEdit:preprocess_arguments")

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

    "PipeImageEdit": PipeImageEdit,
}
