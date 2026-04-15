# ===== AnyType CLASS ==================================================================================================================

class AnyType(str):
    """A special type that can be connected to any other types. Credit to pythongosssss"""
    def __ne__(self, __value: object) -> bool:
        return False

ANY_TYPE = AnyType("*")

# ===== Reroutes ==================================================================================================================

class RerouteBase:
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
            },
            "optional": {
                s.RETURN_NAMES[0] :(s.RETURN_TYPES[0], {
                    "forceInput": True
                }),
            },
        }

    RETURN_TYPES = (ANY_TYPE, )
    RETURN_NAMES = ("value", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = None

    FUNCTION = "execute"
    CATEGORY = "reroute"
    DESCRIPTION = ""

    OUTPUT_NODE = False

    def execute(self, **kwargs, ):        
        args = list(kwargs.values())
        print(kwargs)
        print(args)
        if len(args) > 0:
            return (args[0], )
        else:
            return (self.__class__.DEFAULT_VALUE_IF_DISCONNECTED, )

class RerouteBoolean(RerouteBase):
    RETURN_TYPES = ("BOOLEAN", )
    RETURN_NAMES = ("boolean", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = False

class RerouteFloat(RerouteBase):
    RETURN_TYPES = ("FLOAT", )
    RETURN_NAMES = ("float", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = 0.0

class RerouteInteger(RerouteBase):
    RETURN_TYPES = ("INT", )
    RETURN_NAMES = ("integer", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = 0

class RerouteString(RerouteBase):
    RETURN_TYPES = ("STRING", )
    RETURN_NAMES = ("string", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = ""

class RerouteModel(RerouteBase):
    RETURN_TYPES = ("MODEL", )
    RETURN_NAMES = ("model", ) 

class RerouteClip(RerouteBase):
    RETURN_TYPES = ("CLIP", )
    RETURN_NAMES = ("clip", ) 

class RerouteClipVision(RerouteBase):
    RETURN_TYPES = ("CLIP_VISION", )
    RETURN_NAMES = ("clip_vision", ) 

class RerouteVae(RerouteBase):
    RETURN_TYPES = ("VAE", )
    RETURN_NAMES = ("vae", ) 

class RerouteImage(RerouteBase):
    RETURN_TYPES = ("IMAGE", )
    RETURN_NAMES = ("image", ) 

class RerouteMask(RerouteBase):
    RETURN_TYPES = ("MASK", )
    RETURN_NAMES = ("mask", ) 

class RerouteLatent(RerouteBase):
    RETURN_TYPES = ("LATENT", )
    RETURN_NAMES = ("latent", ) 

class RerouteDict(RerouteBase):
    RETURN_TYPES = ("DICT", )
    RETURN_NAMES = ("dict", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = {}

class RerouteConditioning(RerouteBase):
    RETURN_TYPES = ("CONDITIONING", )
    RETURN_NAMES = ("conditioning", ) 

class RerouteLoraStack(RerouteBase):
    RETURN_TYPES = ("LORA_STACK", )
    RETURN_NAMES = ("lora_stack", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = []

class RerouteControlNetStack(RerouteBase):
    RETURN_TYPES = ("CONTROL_NET_STACK", )
    RETURN_NAMES = ("control_net_stack", ) 
    DEFAULT_VALUE_IF_DISCONNECTED = []

# ===== INITIALIZATION =====================================================================================================================

NODE_LIST = {
    "RerouteAny": RerouteBase,
    "RerouteBoolean": RerouteBoolean,
    "RerouteFloat": RerouteFloat,
    "RerouteInteger": RerouteInteger,
    "RerouteString": RerouteString,
    "RerouteModel": RerouteModel,
    "RerouteClip": RerouteClip,
    "RerouteClipVision": RerouteClipVision,
    "RerouteVae": RerouteVae,
    "RerouteImage": RerouteImage,
    "RerouteMask": RerouteMask,
    "RerouteLatent": RerouteLatent,
    "RerouteDict": RerouteDict,
    "RerouteConditioning": RerouteConditioning,
    "RerouteLoraStack": RerouteLoraStack,
    "RerouteControlNetStack": RerouteControlNetStack,
}
