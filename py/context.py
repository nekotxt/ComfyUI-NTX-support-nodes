from comfy_api.latest import ComfyExtension, io

from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .utils import clone_data, load_list_image_sizes, extract_image_size, DICT_TYPE, LIST_TYPE, LORA_STACK_TYPE, CONTROL_NET_STACK_TYPE


# ===== NODES : CONTEXT ==================================================================================================================

class PipeBase(io.ComfyNode):

    NODE_NAME = ""
    NODE_DESCRIPTION = ""
    LIST_OF_PARAMETERS = {} # in the form: "property name": (io type, options dictionary, return type if property not present in pipe)

    @classmethod
    def define_schema(cls):
        node_id = f"{ADDON_PREFIX}{cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        description = cls.__name__ if cls.NODE_DESCRIPTION == "" else cls.NODE_DESCRIPTION

        inputs = [DICT_TYPE.Input("pipe", optional=True)]
        for name, (type_name, options, _) in cls.LIST_OF_PARAMETERS.items():
            options = {} if options is None else options
            options = options | {"optional": True}
            if type_name in [io.Boolean, io.Float, io.Int, io.String]:
                options = options | {"force_input": True}
            inputs.append(type_name.Input(name, **options))

        outputs = [DICT_TYPE.Output("pipe")]
        for name, (type_name, _, _) in cls.LIST_OF_PARAMETERS.items():
            outputs.append(type_name.Output(name))

        return io.Schema(
            node_id=node_id,
            display_name=node_id,
            description=description,
            category=f"{ADDON_CATEGORY}/context",
            inputs=inputs,
            outputs=outputs,
        )

    @classmethod
    def preprocess_arguments(cls, pipe, kwargs):
        print("PipeBase:preprocess_arguments")

    @classmethod
    def execute(cls, **kwargs):

        pipe = kwargs.get("pipe", None)
        pipe = {} if pipe is None else clone_data(pipe)

        cls.preprocess_arguments(pipe, kwargs)

        return_values = [pipe]

        for k, v in kwargs.items():
            if k == "pipe":
                continue
            if v is not None:
                pipe[k] = v

        for name, (_, _, default_return_value) in cls.LIST_OF_PARAMETERS.items():
            retrieved_value = pipe.get(name, default_return_value)
            return_values.append(retrieved_value)

        return io.NodeOutput(*return_values)

class PipeImageEdit(PipeBase):
    NODE_DESCRIPTION = "Pipe for image generation"
    LIST_OF_PARAMETERS = {
        "model_name"        : (io.AnyType            , None                                                                , None),
        "clip_name"         : (io.AnyType            , None                                                                , None),
        "vae_name"          : (io.AnyType            , None                                                                , None),
        
        "shift"             : (io.Float              , {"default": 3.0, "min": 0.0, "max": 20.0, "step":0.1, "round": 0.1,}, 3.0),
        "clip_skip"         : (io.Int                , {"default": -1, "min": -100, "max": 0, "step": 1,}                  , -1),

        "model"             : (io.Model              , None                                                                , None),
        "clip"              : (io.Clip               , None                                                                , None),
        "vae"               : (io.Vae                , None                                                                , None),

        "prompt_positive"   : (io.String             , {"default": "" }                                                    , ""),
        "prompt_negative"   : (io.String             , {"default": "" }                                                    , ""),
        "text_parameters"   : (DICT_TYPE             , None                                                                , {}),
        "positive"          : (io.Conditioning       , None                                                                , None),
        "negative"          : (io.Conditioning       , None                                                                , None),

        "width"             : (io.Int                , {"default": 0, "min": 128, "max": 4096, "step": 2,}                 , 0),
        "height"            : (io.Int                , {"default": 0, "min": 128, "max": 4096, "step": 2,}                 , 0),
        "batch_size"        : (io.Int                , {"default": 1, "min": 1, "max": 100, "step": 1,}                    , 1),
        "latent"            : (io.Latent             , None                                                                , None),
        "images"            : (io.Image              , None                                                                , None),

        "seed"              : (io.Int                , {"default": 0, "min": -1, "max": 10000000000, "step": 1,}           , 0),
        "steps"             : (io.Int                , {"default": 20, "min": 1, "max": 100, "step": 1,}                   , 20),
        "cfg"               : (io.Float              , {"default": 1.0, "min": 0.0, "max": 20.0, "step":0.1, "round": 0.1,}, 1.0),
        "sampler_name"      : (io.AnyType            , None                                                                , "euler_ancestral"),
        "scheduler"         : (io.AnyType            , None                                                                , "simple"),

        "lora_stack"        : (LORA_STACK_TYPE       , None                                                                , []),
        "control_net_stack" : (CONTROL_NET_STACK_TYPE, None                                                                , []),
    }
    
    @classmethod
    def preprocess_arguments(cls, pipe, kwargs):
        print("PipeImageEdit:preprocess_arguments")


# ===== NODES : IMAGE CREATION PIPELINE ==================================================================================================



# ===== NODES : GENERATION DATA ==========================================================================================================

class GenerationDataSet(io.ComfyNode):

    NEGATIVE_DIVIDER = "##NEGATIVE##"

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GenerationDataSet",
            display_name=f"{ADDON_PREFIX}GenerationDataSet",
            description="Set data for image generation",
            category=f"{ADDON_CATEGORY}/context",
            inputs=[
                io.String.Input("tag", multiline=False, dynamic_prompts=False, default=""),
                io.Combo.Input("image_size", options=["custom"] + load_list_image_sizes(), default="custom"),
                io.Int.Input("width", default=0, min=0, max=4096, step=1),
                io.Int.Input("height", default=0, min=0, max=4096, step=1),
                io.String.Input("prompt", multiline=True, dynamic_prompts=True, default=""),
                
                LIST_TYPE.Input("items", optional=True),
                LORA_STACK_TYPE.Input("opt_lora_stack", optional=True),
                io.Image.Input("opt_image", optional=True),
            ],
            outputs=[
                LIST_TYPE.Output("items"),
            ],
        )

    @classmethod
    def execute(cls, tag, image_size, width, height, prompt, items=None, opt_lora_stack=None, opt_image=None):
        items = [] if items is None else clone_data(items)

        if image_size != "custom": # decode standard image size if any
            width, height = extract_image_size(image_size)

        data = {}
        data["tag"] = tag
        data["width"] = width
        data["height"] = height
        if cls.NEGATIVE_DIVIDER in prompt:
            data["prompt_positive"], data["prompt_negative"] = [v.strip() for v in prompt.split(cls.NEGATIVE_DIVIDER)]
        else:
            data["prompt_positive"], data["prompt_negative"] = prompt, ""
        data["opt_lora_stack"] = [] if opt_lora_stack is None else opt_lora_stack
        data["opt_image"] = opt_image

        items.append(data)

        return io.NodeOutput(items)

class GenerationDataGet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GenerationDataGet",
            display_name=f"{ADDON_PREFIX}GenerationDataGet",
            description="Get data for image generation",
            category=f"{ADDON_CATEGORY}/context",
            inputs=[
                LIST_TYPE.Input("items"),
                io.Int.Input("index", default=0),
            ],
            outputs=[
                LIST_TYPE.Output("items"),
                io.String.Output("tag"),
                io.Int.Output("width"),
                io.Int.Output("height"),
                io.String.Output("prompt_positive"),
                io.String.Output("prompt_negative"),
                LORA_STACK_TYPE.Output("opt_lora_stack"),
                io.Image.Output("opt_image"),
            ],
        )

    @classmethod
    def execute(cls, items, index):
        data = items[index]
        return io.NodeOutput(items, 
            data.get("tag", ""), 
            data.get("width", 0), 
            data.get("height", 0), 
            data.get("prompt_positive", ""), 
            data.get("prompt_negative", ""), 
            data.get("opt_lora_stack", []), 
            data.get("opt_image", None)
        )

class GenerationDataMaxSize(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GenerationDataMaxSize",
            display_name=f"{ADDON_PREFIX}GenerationDataMaxSize",
            description="Get max image size in the set of image generation data",
            category=f"{ADDON_CATEGORY}/context",
            inputs=[
                LIST_TYPE.Input("items"),
            ],
            outputs=[
                LIST_TYPE.Output("items"),
                io.Int.Output("width"),
                io.Int.Output("height"),
            ],
        )

    @classmethod
    def execute(cls, items):
        max_width = 0
        max_height = 0

        for data in items:
            w = data.get("width", 0) 
            h = data.get("height", 0)
            if w > max_width:
                max_width = w
            if h > max_height:
                max_height = h

        return io.NodeOutput(items, max_width, max_height)


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        PipeImageEdit,

        GenerationDataSet,
        GenerationDataGet,
        GenerationDataMaxSize,
    ]
