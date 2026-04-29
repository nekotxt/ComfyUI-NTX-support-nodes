from comfy_api.latest import ComfyExtension, io

from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .utils import DICT_TYPE, LIST_TYPE, LORA_STACK_TYPE, CONTROL_NET_STACK_TYPE

# ===== Reroutes ==================================================================================================================

class RerouteBase(io.ComfyNode):
    NODE_NAME = ""
    DATA_TYPE = io.AnyType
    DATA_NAME = "value"
    DATA_OPTIONS = {}
    DEFAULT_VALUE_IF_DISCONNECTED = None

    @classmethod
    def define_schema(cls):
        node_id = f"{ADDON_PREFIX}{cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        display_name = f"{ADDON_PREFIX} {cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        description = f"{ADDON_PREFIX} Reroute node for {cls.DATA_NAME} data type"

        return io.Schema(
            node_id=node_id,
            display_name=display_name,
            description=description,
            category=f"{ADDON_CATEGORY}/reroute",
            inputs=[
                cls.DATA_TYPE.Input(cls.DATA_NAME, optional=True, **cls.DATA_OPTIONS) 
            ],
            outputs=[
                cls.DATA_TYPE.Output(cls.DATA_NAME),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        args = list(kwargs.values())
        if args and len(args) > 0:
            return io.NodeOutput(args[0])
        return io.NodeOutput(cls.DEFAULT_VALUE_IF_DISCONNECTED)


class RerouteAny(RerouteBase):
    DATA_TYPE = io.AnyType
    DATA_NAME = "value"
    DATA_OPTIONS = {}
    DEFAULT_VALUE_IF_DISCONNECTED = None


class RerouteBoolean(RerouteBase):
    DATA_TYPE = io.Boolean
    DATA_NAME = "boolean"
    DATA_OPTIONS = {"force_input": True}
    DEFAULT_VALUE_IF_DISCONNECTED = False


class RerouteFloat(RerouteBase):
    DATA_TYPE = io.Float
    DATA_NAME = "float"
    DATA_OPTIONS = {"force_input": True}
    DEFAULT_VALUE_IF_DISCONNECTED = 0.0


class RerouteInteger(RerouteBase):
    DATA_TYPE = io.Int
    DATA_NAME = "integer"
    DATA_OPTIONS = {"force_input": True}
    DEFAULT_VALUE_IF_DISCONNECTED = 0


class RerouteString(RerouteBase):
    DATA_TYPE = io.String
    DATA_NAME = "string"
    DATA_OPTIONS = {"force_input": True}
    DEFAULT_VALUE_IF_DISCONNECTED = ""


class RerouteModel(RerouteBase):
    DATA_TYPE = io.Model
    DATA_NAME = "model"


class RerouteClip(RerouteBase):
    DATA_TYPE = io.Clip
    DATA_NAME = "clip"


class RerouteClipVision(RerouteBase):
    DATA_TYPE = io.ClipVision
    DATA_NAME = "clip_vision"


class RerouteVae(RerouteBase):
    DATA_TYPE = io.Vae
    DATA_NAME = "vae"


class RerouteImage(RerouteBase):
    DATA_TYPE = io.Image
    DATA_NAME = "image"


class RerouteMask(RerouteBase):
    DATA_TYPE = io.Mask
    DATA_NAME = "mask"


class RerouteLatent(RerouteBase):
    DATA_TYPE = io.Latent
    DATA_NAME = "latent"


class RerouteDict(RerouteBase):
    DATA_TYPE = DICT_TYPE
    DATA_NAME = "dict"
    DEFAULT_VALUE_IF_DISCONNECTED = {}


class RerouteList(RerouteBase):
    DATA_TYPE = LIST_TYPE
    DATA_NAME = "list"
    DEFAULT_VALUE_IF_DISCONNECTED = []


class RerouteConditioning(RerouteBase):
    DATA_TYPE = io.Conditioning
    DATA_NAME = "conditioning"


class RerouteLoraStack(RerouteBase):
    DATA_TYPE = LORA_STACK_TYPE
    DATA_NAME = "lora_stack"
    DEFAULT_VALUE_IF_DISCONNECTED = []


class RerouteControlNetStack(RerouteBase):
    DATA_TYPE = CONTROL_NET_STACK_TYPE
    DATA_NAME = "control_net_stack"
    DEFAULT_VALUE_IF_DISCONNECTED = []


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        RerouteAny,
        RerouteBoolean,
        RerouteFloat,
        RerouteInteger,
        RerouteString,
        RerouteModel,
        RerouteClip,
        RerouteClipVision,
        RerouteVae,
        RerouteImage,
        RerouteMask,
        RerouteLatent,
        RerouteDict,
        RerouteList,
        RerouteConditioning,
        RerouteLoraStack,
        RerouteControlNetStack,
    ]
