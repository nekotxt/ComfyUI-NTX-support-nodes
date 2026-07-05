from comfy_api.latest import ComfyExtension, io

from typing_extensions import override

import json
import textwrap

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, API_PREFIX, SETTINGS_DIR
from .logging import logger
from .utils import clone_data, load_list_image_sizes, extract_image_size, notify_user, DICT_TYPE, LIST_TYPE, LORA_STACK_TYPE, CONTROL_NET_STACK_TYPE


# ===== NODES : CONTEXT ==================================================================================================================

# The context nodes are derived from PipeBase and all share the same structure:
# - they all have a pipe input and output (DICT type)
# - inputs and outputs are the same
# - LIST_OF_PARAMETERS defines the additional inputs/outputs specific of the pipe
# - each parameter is defined by name, type, optional parameters, default value
# - the optional parameters are used when the input is created
# - the default value is returned as output, if the parameter is not present in the pipe
# - all parameters are optional and forced to be input only (no widgets)

class PipeBase(io.ComfyNode):

    NODE_NAME = ""
    NODE_DESCRIPTION = ""
    LIST_OF_PARAMETERS = {} # in the form: "property name": (io type, options dictionary, return type if property not present in pipe)

    @classmethod
    def define_schema(cls):
        node_id = f"{ADDON_PREFIX}{cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        display_name = f"{ADDON_PREFIX} {cls.__name__ if cls.NODE_NAME == "" else cls.NODE_NAME}"

        description = cls.__name__ if cls.NODE_DESCRIPTION == "" else cls.NODE_DESCRIPTION

        inputs = [DICT_TYPE.Input("pipe", optional=True)]
        for name, (type_name, options, _) in cls.LIST_OF_PARAMETERS.items():
            # if no options are specified for the parameter, just start with an empty dict
            options = {} if options is None else options
            # always include the "optional" flag for these parameters
            options = options | {"optional": True}
            # for primitive types, force the input to be slot-only (no widget), unless the options explicitely require it
            if type_name in [io.Boolean, io.Float, io.Int, io.String]:
                if options.get("force_input", None) is None:
                    options = options | {"force_input": True}
            inputs.append(type_name.Input(name, **options))

        outputs = [DICT_TYPE.Output("pipe")]
        for name, (type_name, _, _) in cls.LIST_OF_PARAMETERS.items():
            outputs.append(type_name.Output(name))

        return io.Schema(
            node_id=node_id,
            display_name=display_name,
            description=description,
            category=f"{ADDON_CATEGORY}/deprecated/context",
            inputs=inputs,
            outputs=outputs,
        )

    @classmethod
    def preprocess_inputs(cls, pipe, kwargs):
        # optional call to be overridden in derived classes, to manipulate the input data before processing
        pass

    @classmethod
    def postprocess_results(cls, pipe, return_values):
        # optional call to be overridden in derived classes, to manipulate the output data after processing
        pass

    @classmethod
    def execute(cls, **kwargs):

        pipe = kwargs.get("pipe", None)
        pipe = {} if pipe is None else clone_data(pipe)

        cls.preprocess_inputs(pipe, kwargs)

        return_values = [pipe]

        for k, v in kwargs.items():
            if k == "pipe":
                continue
            if v is not None:
                pipe[k] = v

        for name, (_, _, default_return_value) in cls.LIST_OF_PARAMETERS.items():
            retrieved_value = pipe.get(name, default_return_value)
            return_values.append(retrieved_value)

        cls.postprocess_results(pipe, return_values)

        return io.NodeOutput(*return_values)

class PipeImageEdit(PipeBase):
    NODE_DESCRIPTION = "Pipe for image generation"
    LIST_OF_PARAMETERS = {
        "model_name"        : (io.AnyType            , None                                                                 , None),
        "clip_name"         : (io.AnyType            , None                                                                 , None),
        "vae_name"          : (io.AnyType            , None                                                                 , None),
        
        "shift"             : (io.Float              , {"default": 3.0, "min": 0.0, "max": 100.0, "step":0.1, "round": 0.1,}, 3.0),
        "clip_skip"         : (io.Int                , {"default": -1, "min": -100, "max": 0, "step": 1,}                   , -1),

        "model"             : (io.Model              , None                                                                 , None),
        "clip"              : (io.Clip               , None                                                                 , None),
        "vae"               : (io.Vae                , None                                                                 , None),

        "prompt_positive"   : (io.String             , {"default": "" }                                                     , ""),
        "prompt_negative"   : (io.String             , {"default": "" }                                                     , ""),
        "text_parameters"   : (DICT_TYPE             , None                                                                 , {}),
        "positive"          : (io.Conditioning       , None                                                                 , None),
        "negative"          : (io.Conditioning       , None                                                                 , None),

        "width"             : (io.Int                , {"default": 0, "min": 128, "max": 4096, "step": 2,}                  , 0),
        "height"            : (io.Int                , {"default": 0, "min": 128, "max": 4096, "step": 2,}                  , 0),
        "batch_size"        : (io.Int                , {"default": 1, "min": 1, "max": 100, "step": 1,}                     , 1),
        "latent"            : (io.Latent             , None                                                                 , None),
        "images"            : (io.Image              , None                                                                 , None),

        "seed"              : (io.Int                , {"default": 0, "min": -1, "max": 10000000000, "step": 1,}            , 0),
        "steps"             : (io.Int                , {"default": 20, "min": 1, "max": 100, "step": 1,}                    , 20),
        "cfg"               : (io.Float              , {"default": 1.0, "min": 0.0, "max": 100.0, "step":0.1, "round": 0.1,}, 1.0),
        "sampler_name"      : (io.AnyType            , None                                                                 , "euler_ancestral"),
        "scheduler"         : (io.AnyType            , None                                                                 , "simple"),

        "lora_stack"        : (LORA_STACK_TYPE       , None                                                                 , []),
        "control_net_stack" : (CONTROL_NET_STACK_TYPE, None                                                                 , []),

        "guidance"          : (io.Float              , {"default": 0.0, "min": 0.0, "max": 100.0, "step":0.1, "round": 0.1,}, 0.0),
    }

class PipeVideoWan(PipeBase):
    NODE_DESCRIPTION = "Pipe for Wan video generation"
    LIST_OF_PARAMETERS = {
        "images"            : (io.Image              , None                                                                 , None),

        "ref_image"         : (io.Image              , None                                                                 , None),

        "latent"            : (io.Latent             , None                                                                 , None),

        "prompt_positive"   : (io.String             , {"default": "" }                                                     , ""),
        "prompt_negative"   : (io.String             , {"default": "" }                                                     , ""),

        "width"             : (io.Int                , {"default": 480, "min": 128, "max": 4096, "step": 2,}                , 480),
        "height"            : (io.Int                , {"default": 720, "min": 128, "max": 4096, "step": 2,}                , 720),

        "duration"          : (io.Int                , {"default": 5, "min": 1, "max": 100, "step": 1,}                     , 5),
        "frame_rate"        : (io.Float              , {"default": 16.0, "min": 1.0, "max": 60.0, "step":1.0, "round": 0.1,}, 16.0),
        "shift"             : (io.Float              , {"default": 5.0, "min": 1.0, "max": 100.0, "step":0.1, "round": 0.1,}, 5.0),

        "cfg_high"          : (io.Float              , {"default": 1.0, "min": 0.0, "max": 100.0, "step":0.1, "round": 0.1,}, 1.0),
        "cfg_low"           : (io.Float              , {"default": 1.0, "min": 0.0, "max": 100.0, "step":0.1, "round": 0.1,}, 1.0),
        "sampler_name"      : (io.AnyType            , None                                                                 , "euler"),
        "scheduler"         : (io.AnyType            , None                                                                 , "simple"),
        "steps_total"       : (io.Int                , {"default": 4, "min": 1, "max": 100, "step": 1,}                     , 4),
        "steps_split"       : (io.Int                , {"default": 2, "min": 1, "max": 100, "step": 1,}                     , 2),

        "seed"              : (io.Int                , {"default": 42, "min": -1, "max": 10000000000, "step": 1,}           , 42),

        "lora_stack_1"      : (LORA_STACK_TYPE       , None                                                                 , []),
        "lora_stack_2"      : (LORA_STACK_TYPE       , None                                                                 , []),
    }

# ===== NODES : CUSTOM CONTEXT (MANAGED BY FRONT END) ====================================================================================

PIPE_MAX_SLOTS = 30   # max custom inputs/outputs per PipeCustom node (mirrored in web/js/context.pipe_custom.js)

# default output values per type, used when a name is not found in the pipe
# (types without a default return None) — edit to customize
DEFAULT_PIPE_VALUES = {
    "INT": 0,
    "FLOAT": 0.0,
    "STRING": "",
    "BOOLEAN": False,
    "LORA_STACK": [],
    "CONTROL_NET_STACK": [],
    "DICT": {},
    "LIST": [],
}

# input names that cannot be used for custom pipe entries
RESERVED_PIPE_NAMES = ("pipe", "inputs_data", "strict")

def parse_entry_list(data):
    """Parse one editor entry list ([{"name":..., "type":...}, ...]) into an ordered
    list of valid names, plus a name:type dictionary."""
    if not isinstance(data, list):
        data = []

    names = []
    types = {}
    for entry in data:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name", "")).strip()
        if not name or name in RESERVED_PIPE_NAMES or name in names:
            continue
        names.append(name)
        types[name] = str(entry.get("type", "*"))
        if len(names) >= PIPE_MAX_SLOTS:
            break
    return (names, types)

def parse_inputs_data(inputs_data):
    """Parse the JSON produced by the frontend editor into (in_names, in_types,
    out_names, out_types). Current format: {"inputs": [...], "outputs": [...]}.
    Legacy format (a single list) is applied to both inputs and outputs."""
    try:
        data = json.loads(inputs_data)
    except (json.JSONDecodeError, TypeError):
        data = []

    if isinstance(data, dict):
        (in_names, in_types) = parse_entry_list(data.get("inputs"))
        (out_names, out_types) = parse_entry_list(data.get("outputs"))
    else:
        (in_names, in_types) = parse_entry_list(data)
        (out_names, out_types) = (in_names, in_types)
    return (in_names, in_types, out_names, out_types)

class PipeCustom(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}PipeCustom",
            display_name=f"{ADDON_PREFIX} Pipe Custom",
            description="Pipe with separately user-defined inputs and outputs; connected input values are merged into the pipe dictionary, outputs are read from it.",
            category=f"{ADDON_CATEGORY}/pipe",
            # the custom inputs are created by the frontend (web/js/pipe_custom.js) and are
            # not part of the schema: accept_all_inputs makes them reach execute() as kwargs
            accept_all_inputs=True,
            inputs=[
                DICT_TYPE.Input("pipe", optional=True),
                io.String.Input("inputs_data", default="[]"),
                io.Boolean.Input("strict", default=False,
                                 tooltip="Warn when a configured output name is not found in the pipe (a per-type default is returned either way)"),
            ],
            # links are validated by output index, so the maximum number of outputs must be
            # declared here; the frontend shows/renames only the configured ones
            outputs=[DICT_TYPE.Output("pipe")]
                    + [io.AnyType.Output(f"out_{i}") for i in range(PIPE_MAX_SLOTS)],
        )

    @classmethod
    def execute(cls, inputs_data, strict=False, pipe=None, **kwargs):
        (in_names, in_types, out_names, out_types) = parse_inputs_data(inputs_data)
        #logger.info(f"PipeCustom : {inputs_data}")
        #logger.info(f"PipeCustom : {kwargs}")

        new_pipe = clone_data(pipe) if pipe is not None else {}
        if not isinstance(new_pipe, dict):
            logger.warning("PipeCustom : input pipe is not a dictionary, starting from an empty pipe")
            new_pipe = {}

        for name in in_names:
            value = kwargs.get(name)
            if value is not None:
                new_pipe[name] = value
                #logger.info(f"PipeCustom : {name}[{in_types[name]}] <= {value}")

        # recover output from pipe. If not present, try to get a default if available
        outputs = []
        missing = []
        for name in out_names:
            if name in new_pipe:
                outputs.append(new_pipe[name])
                #logger.info(f"PipeCustom : {name}[{out_types[name]}] => {new_pipe[name]}")
            else:
                outputs.append(DEFAULT_PIPE_VALUES.get(out_types[name], None))
                missing.append(name)
                #logger.info(f"PipeCustom : {name}[{out_types[name]}] => {DEFAULT_PIPE_VALUES.get(out_types[name], None)}")

        # in strict mode, outputs that fell back to their default are reported to
        # the user — typically a typo between an upstream input and this output
        if strict and missing:
            msg = f"output name(s) not found in pipe : {', '.join(missing)}"
            notify_user("warn", "PipeCustom", msg)
            logger.warning(f"PipeCustom : {msg}")

        return io.NodeOutput(new_pipe, *outputs)

class PipeMerge(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        autogrow_template = io.Autogrow.TemplatePrefix(
            input=DICT_TYPE.Input("pipe"),  # template for each input
            prefix="pipe",                  # prefix for generated input names
            min=2,                           # minimum number of inputs shown
            max=10,                          # maximum number of inputs allowed
        )
        return io.Schema(
            node_id=f"{ADDON_PREFIX}PipeMerge",
            display_name=f"{ADDON_PREFIX} Pipe Merge",
            description="Merge multiple pipes",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=[
                io.Autogrow.Input("inputs", template=autogrow_template),
            ],
            outputs=[io.AnyType.Output("pipe")],
        )

    @classmethod
    def execute(cls, inputs: io.Autogrow.Type) -> io.NodeOutput:
        # 'inputs' is a dict mapping input names to their values
        output_pipe = {}
        for pipe in list(inputs.values()):
            output_pipe.update(clone_data(pipe))
        return io.NodeOutput(output_pipe)

# ===== NODES : DEBUG PIPE ====================================================================================

# format a multiline string
def format_multiline_string(leader, text, max_width):
    return leader + textwrap.fill(text, width=(max_width-len(leader))).replace("\n", "\n" + ' '*len(leader))

def print_pipe_data(prefix:str, name:str, data):
    text = ""

    if "prompt_" in name:
        leader = f"{prefix}{name} : "
        text += format_multiline_string(leader, str(data), 100) + "\n"
    elif "lora_stack" in name and type(data) is list:
        text += f"{prefix}{name} :\n"
        i = 0
        for entry in data:
            text += f"{prefix}- [{str(i)}] {entry}\n"
            i += 1
    elif type(data) is dict:
        text += f"{prefix}{name} :\n"
        names = list(data.keys())
        names.sort()
        for k in names:
            text += print_pipe_data(prefix + "  ", k, data.get(k))
    elif type(data) is list:
        text += f"{prefix}{name} :\n"
        i = 0
        for entry in data:
            text += print_pipe_data(f"{prefix}- ", f"[{str(i)}]", entry)
            i += 1
    elif str(type(data)) == "<class 'torch.Tensor'>":
        text += f"{prefix}{name} : torch.Tensor\n"
    else:
        text += f"{prefix}{name} : {str(data)}\n"

    return text


class PipeDebug(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}PipeDebug",
            display_name=f"{ADDON_PREFIX} Pipe Debug",
            description="Print the information in the pipe dictionary.",
            category=f"{ADDON_CATEGORY}/pipe",
            inputs=[
                DICT_TYPE.Input("pipe"),
            ],
            # links are validated by output index, so the maximum number of outputs must be
            # declared here; the frontend shows/renames only the configured ones
            outputs=[
                DICT_TYPE.Output("pipe"),
                io.String.Output("text"),
            ]
        )

    @classmethod
    def execute(cls, pipe):

        text = ""
        
        names = list(pipe.keys())
        names.sort()
        for k in names:
            text += print_pipe_data("", k, pipe.get(k))

        return io.NodeOutput(pipe, text)

# ===== NODES : GENERATION DATA ==========================================================================================================

class GenerationDataSet(io.ComfyNode):

    NEGATIVE_DIVIDER = "##NEGATIVE##"

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GenerationDataSet",
            display_name=f"{ADDON_PREFIX} GenerationData Set",
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
                DICT_TYPE.Input("opt_extra", optional=True),
            ],
            outputs=[
                LIST_TYPE.Output("items"),
            ],
        )

    @classmethod
    def execute(cls, tag, image_size, width, height, prompt, items=None, opt_lora_stack=None, opt_image=None, opt_extra=None):
        items = [] if items is None else clone_data(items)

        if image_size != "custom": # decode standard image size if any
            width, height = extract_image_size(image_size)

        data = {} if opt_extra is None else opt_extra
        
        data["tag"] = tag
        data["width"] = width
        data["height"] = height
        if cls.NEGATIVE_DIVIDER in prompt:
            data["prompt_positive"], data["prompt_negative"] = [v.strip() for v in prompt.split(cls.NEGATIVE_DIVIDER, 1)]
        else:
            data["prompt_positive"], data["prompt_negative"] = prompt.strip(), ""
        data["opt_lora_stack"] = [] if opt_lora_stack is None else opt_lora_stack
        data["opt_image"] = opt_image

        items.append(data)

        return io.NodeOutput(items)

class GenerationDataGet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GenerationDataGet",
            display_name=f"{ADDON_PREFIX} GenerationData Get",
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
                DICT_TYPE.Output("opt_extra"),
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
            data.get("opt_image", None),
            data
        )

class GenerationDataMaxSize(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GenerationDataMaxSize",
            display_name=f"{ADDON_PREFIX} GenerationData MaxSize",
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
        PipeVideoWan,

        PipeCustom,

        PipeMerge,

        PipeDebug,

        GenerationDataSet,
        GenerationDataGet,
        GenerationDataMaxSize,
    ]

# ===== JAVASCRIPT API =====================================================================================================================

# Pre-defined property sets the frontend editor can load. Stored in
# input/ntx_data/custompipe_configs.txt: each template starts with a name line,
# followed by "- name:type" property lines; a blank line separates templates.
CUSTOMPIPE_TEMPLATES_FILE = SETTINGS_DIR / "custompipe_configs.txt"

def load_custompipe_templates():
    """Parse the templates file into a list of
    [{"name": <template>, "properties": [{"name":..., "type":...}, ...]}, ...]."""
    templates = []
    if not CUSTOMPIPE_TEMPLATES_FILE.is_file():
        return templates

    current = None
    try:
        with open(CUSTOMPIPE_TEMPLATES_FILE, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                if line.startswith("-"):
                    if current is None:
                        continue   # property line before any template name — skip
                    name, sep, ptype = line[1:].partition(":")
                    name = name.strip()
                    ptype = ptype.strip() if sep else ""
                    if name:
                        current["properties"].append({"name": name, "type": ptype or "*"})
                else:
                    current = {"name": line, "properties": []}
                    templates.append(current)
    except OSError as e:
        logger.warning(f"PipeCustom : could not read custom pipe templates : {e}")
        return []
    return templates

def format_custompipe_templates(templates):
    """Serialize a template list back into the custompipe_configs.txt format."""
    lines = []
    for tpl in templates:
        lines.append(tpl["name"])
        for prop in tpl["properties"]:
            lines.append(f"- {prop['name']}:{prop['type']}")
        lines.append("")
    return "\n".join(lines)

def save_custompipe_template(name, properties, overwrite=False):
    """Add (or replace) one named template in CUSTOMPIPE_TEMPLATES_FILE, keeping
    the others. Returns (ok, status); status is "saved", "exists" (name taken and
    overwrite not set) or an error message."""
    name = str(name or "").strip()
    if not name or name.startswith("-") or any(c in name for c in "\r\n"):
        return (False, "invalid template name")

    props = []
    seen = set()
    for prop in properties if isinstance(properties, list) else []:
        if not isinstance(prop, dict):
            continue
        pname = str(prop.get("name", "")).strip()
        ptype = str(prop.get("type", "*")).strip() or "*"
        # ":" separates name and type in the file format, so neither part may contain it
        if not pname or any(c in pname + ptype for c in ":\r\n"):
            return (False, f"invalid property : {pname or '(unnamed)'}")
        if pname in RESERVED_PIPE_NAMES or pname in seen:
            continue
        seen.add(pname)
        props.append({"name": pname, "type": ptype})
    if not props:
        return (False, "no valid properties")

    templates = load_custompipe_templates()
    existing = next((tpl for tpl in templates if tpl["name"] == name), None)
    if existing is not None:
        if not overwrite:
            return (False, "exists")
        existing["properties"] = props
    else:
        templates.append({"name": name, "properties": props})

    try:
        CUSTOMPIPE_TEMPLATES_FILE.parent.mkdir(parents=True, exist_ok=True)
        CUSTOMPIPE_TEMPLATES_FILE.write_text(format_custompipe_templates(templates), encoding="utf-8")
    except OSError as e:
        logger.warning(f"PipeCustom : could not save custom pipe template : {e}")
        return (False, f"could not save : {e}")

    logger.info(f"PipeCustom : template '{name}' saved ({len(props)} properties)")
    return (True, "saved")


from aiohttp import web
from server import PromptServer

@PromptServer.instance.routes.get(f"/{API_PREFIX}/load_custompipe_templates")
async def load_custompipe_templates_route(request):
    return web.json_response(load_custompipe_templates())

@PromptServer.instance.routes.post(f"/{API_PREFIX}/save_custompipe_template")
async def save_custompipe_template_route(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    (ok, status) = save_custompipe_template(
        data.get("name"), data.get("properties"), bool(data.get("overwrite", False)))
    return web.json_response({"ok": ok, "status": status})
