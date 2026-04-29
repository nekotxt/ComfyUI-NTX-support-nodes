from comfy_api.latest import ComfyExtension, io

from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .utils import clone_data, DICT_TYPE, LIST_TYPE, LORA_STACK_TYPE, CONTROL_NET_STACK_TYPE

# ===== NODES : DICTIONARY SET WITH MULTIPLE ENTRIES ===========================================================================================

class DictSetMulti(io.ComfyNode):
    """
    Base class for multi-key dictionary set nodes.
    Subclasses should override NUMBER_OF_PARAMETERS and define_schema()
    to match their desired number of key/value pairs.
    """
    NODE_NAME = ""
    NUMBER_OF_PARAMETERS = 1

    @classmethod
    def define_schema(cls):
        # Schema for the default single-parameter case (NUMBER_OF_PARAMETERS = 1).
        # Subclasses with more parameters must override this method.

        node_id = f"{ADDON_PREFIX}{cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        display_name = f"{ADDON_PREFIX} {cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        inputs = [DICT_TYPE.Input("pipe", optional=True)]
        if cls.NUMBER_OF_PARAMETERS == 1:
            inputs.append(io.String.Input("key", default=""))
            inputs.append(io.AnyType.Input("value", optional=True))
        else:
            for i in range(1,cls.NUMBER_OF_PARAMETERS+1):
                inputs.append(io.String.Input(f"key{i}", default=""))
                inputs.append(io.AnyType.Input(f"value{i}", optional=True))

        return io.Schema(
            node_id=node_id,
            display_name=display_name,
            description="Dictionary set",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=inputs,
            outputs=[
                DICT_TYPE.Output("pipe"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        pipe = kwargs.get("pipe")
        pipe = {} if pipe is None else clone_data(pipe)

        if cls.NUMBER_OF_PARAMETERS == 1:
            key = kwargs.get("key")
            value = kwargs.get("value")
            if value is None:
                if key in pipe:
                    del pipe[key]
            else:
                pipe[key] = value
        else:
            for i in range(1, cls.NUMBER_OF_PARAMETERS + 1):
                key = kwargs.get(f"key{i}")
                value = kwargs.get(f"value{i}")
                if value is None:
                    if key in pipe:
                        del pipe[key]
                else:
                    pipe[key] = value
        return io.NodeOutput(pipe)

class DictSet1(DictSetMulti):
    NUMBER_OF_PARAMETERS = 1

class DictSet5(DictSetMulti):
    NUMBER_OF_PARAMETERS = 5

class DictSet10(DictSetMulti):
    NUMBER_OF_PARAMETERS = 10


# ===== NODES : DICTIONARY GET/SET FOR TYPES ===============================================================================================

class DictSet(io.ComfyNode):
    """
    Base class for typed dictionary set nodes.
    Subclasses can override NODE_NAME, DATA_TYPE 
    and optionally DATA_OPTIONS, DEFAULT_VALUE_IF_DISCONNECTED
    to accept a specific value type.
    """
    NODE_NAME = ""
    DATA_TYPE = io.AnyType
    DATA_OPTIONS = {}
    DEFAULT_VALUE_IF_DISCONNECTED = None

    @classmethod
    def define_schema(cls):
        node_id = f"{ADDON_PREFIX}{cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        display_name = f"{ADDON_PREFIX} {cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        return io.Schema(
            node_id=node_id,
            display_name=display_name,
            description="Dictionary set",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=[
                io.String.Input("key", default=""),

                DICT_TYPE.Input("pipe", optional=True),
                cls.DATA_TYPE.Input("value", optional=True, **cls.DATA_OPTIONS),
            ],
            outputs=[
                DICT_TYPE.Output("pipe"),
            ],
        )

    @classmethod
    def execute(cls, key, pipe=None, value=None):
        if key == "":
            return io.NodeOutput(pipe)
        if value is None:
            return io.NodeOutput(pipe)

        pipe = {} if pipe is None else clone_data(pipe)
        pipe[key] = value

        return io.NodeOutput(pipe)

class DictGet(io.ComfyNode):
    """
    Base class for typed dictionary get nodes.
    Subclasses can override NODE_NAME, DATA_TYPE 
    and optionally DATA_OPTIONS, DEFAULT_VALUE_IF_DISCONNECTED
    to return a specific value type.
    """
    NODE_NAME = ""
    DATA_TYPE = io.AnyType
    DATA_OPTIONS = {}
    DEFAULT_VALUE_IF_DISCONNECTED = None

    @classmethod
    def define_schema(cls):
        node_id = f"{ADDON_PREFIX}{cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        display_name = f"{ADDON_PREFIX} {cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        return io.Schema(
            node_id=node_id,
            display_name=display_name,
            description="Dictionary get",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=[
                DICT_TYPE.Input("pipe"),
                io.String.Input("key", default=""),

                cls.DATA_TYPE.Input("default", optional=True, **cls.DATA_OPTIONS),
            ],
            outputs=[
                DICT_TYPE.Output("pipe"),
                cls.DATA_TYPE.Output("value"),
            ],
        )

    @classmethod
    def execute(cls, pipe, key, default=None):
        if default is None:
            default = cls.DEFAULT_VALUE_IF_DISCONNECTED

        return io.NodeOutput(pipe, pipe.get(key, default))


class DictSetBoolean(DictSet):
    DATA_TYPE = io.Boolean
    DEFAULT_VALUE_IF_DISCONNECTED = False

class DictGetBoolean(DictGet):
    DATA_TYPE = io.Boolean
    DEFAULT_VALUE_IF_DISCONNECTED = False


class DictSetFloat(DictSet):
    DATA_TYPE = io.Float
    DEFAULT_VALUE_IF_DISCONNECTED = 0.0

class DictGetFloat(DictGet):
    DATA_TYPE = io.Float
    DEFAULT_VALUE_IF_DISCONNECTED = 0.0


class DictSetInt(DictSet):
    DATA_TYPE = io.Int
    DEFAULT_VALUE_IF_DISCONNECTED = 0

class DictGetInt(DictGet):
    DATA_TYPE = io.Int
    DEFAULT_VALUE_IF_DISCONNECTED = 0


class DictSetString(DictSet):
    DATA_TYPE = io.String
    DATA_OPTIONS = {"multiline": False, "dynamic_prompts": False}
    DEFAULT_VALUE_IF_DISCONNECTED = ""

class DictSetStringMultiline(DictSet):
    DATA_TYPE = io.String
    DATA_OPTIONS = {"multiline": True, "dynamic_prompts": True}
    DEFAULT_VALUE_IF_DISCONNECTED = ""

class DictGetString(DictGet):
    DATA_TYPE = io.String
    DEFAULT_VALUE_IF_DISCONNECTED = ""


class DictSetModel(DictSet):
    DATA_TYPE = io.Model

class DictGetModel(DictGet):
    DATA_TYPE = io.Model


class DictSetClip(DictSet):
    DATA_TYPE = io.Clip

class DictGetClip(DictGet):
    DATA_TYPE = io.Clip


class DictSetConditioning(DictSet):
    DATA_TYPE = io.Conditioning

class DictGetConditioning(DictGet):
    DATA_TYPE = io.Conditioning


class DictSetVae(DictSet):
    DATA_TYPE = io.Vae

class DictGetVae(DictGet):
    DATA_TYPE = io.Vae


class DictSetLatent(DictSet):
    DATA_TYPE = io.Latent

class DictGetLatent(DictGet):
    DATA_TYPE = io.Latent


class DictSetImage(DictSet):
    DATA_TYPE = io.Image

class DictGetImage(DictGet):
    DATA_TYPE = io.Image


class DictSetMask(DictSet):
    DATA_TYPE = io.Mask

class DictGetMask(DictGet):
    DATA_TYPE = io.Mask


class DictSetLoraStack(DictSet):
    DATA_TYPE = LORA_STACK_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = []

class DictGetLoraStack(DictGet):
    DATA_TYPE = LORA_STACK_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = []


class DictSetControlNetStack(DictSet):
    DATA_TYPE = CONTROL_NET_STACK_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = []

class DictGetControlNetStack(DictGet):
    DATA_TYPE = CONTROL_NET_STACK_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = []


class DictSetList(DictSet):
    DATA_TYPE = LIST_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = []

class DictGetList(DictGet):
    DATA_TYPE = LIST_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = []


class DictSetDict(DictSet):
    DATA_TYPE = DICT_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = {}

class DictGetDict(DictGet):
    DATA_TYPE = DICT_TYPE
    DEFAULT_VALUE_IF_DISCONNECTED = {}


# ===== NODES : LIST =====================================================================================================================

class ListSet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ListSet",
            display_name=f"{ADDON_PREFIX} List Set",
            description="List set",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=[
                LIST_TYPE.Input("items", optional=True),
                io.AnyType.Input("value", optional=True),
            ],
            outputs=[
                LIST_TYPE.Output("items"),
            ],
        )

    @classmethod
    def execute(cls, items=None, value=None):
        items = [] if items is None else clone_data(items)
        items.append(value)
        return io.NodeOutput(items)

class ListCount(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ListCount",
            display_name=f"{ADDON_PREFIX} List Count",
            description="List count",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=[
                LIST_TYPE.Input("items"),
            ],
            outputs=[
                LIST_TYPE.Output("items"),
                io.Int.Output("count"),
            ],
        )

    @classmethod
    def execute(cls, items):
        return io.NodeOutput(items, len(items))

class ListGet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ListGet",
            display_name=f"{ADDON_PREFIX} List Get",
            description="List get",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=[
                LIST_TYPE.Input("items"),
                io.Int.Input("index", default=0),
            ],
            outputs=[
                LIST_TYPE.Output("items"),
                io.AnyType.Output("value"),
            ],
        )

    @classmethod
    def execute(cls, items, index):
        return io.NodeOutput(items, items[index])


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        DictSet1,
        DictSet5,
        DictSet10,

        DictSet, DictGet,
        DictSetBoolean, DictGetBoolean,
        DictSetFloat, DictGetFloat,
        DictSetInt, DictGetInt,
        DictSetString, DictSetStringMultiline, DictGetString,
        DictSetModel, DictGetModel,
        DictSetClip, DictGetClip,
        DictSetVae, DictGetVae,
        DictSetConditioning, DictGetConditioning,
        DictSetLatent, DictGetLatent,
        DictSetImage, DictGetImage,
        DictSetMask, DictGetMask,
        DictSetLoraStack, DictGetLoraStack,
        DictSetControlNetStack, DictGetControlNetStack,
        DictSetList, DictGetList,
        DictSetDict, DictGetDict,

        ListSet,
        ListCount,
        ListGet,
    ]
