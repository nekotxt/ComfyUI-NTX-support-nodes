from comfy_api.latest import ComfyExtension, io, ui

import datetime
import os
import re
from pathlib import Path
from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger
from .utils import clone_data, DICT_TYPE, LORA_STACK_TYPE
from .loras import ConvertLoraStringToStack

# ===== NODES ==============================================================================================================================

JS_TO_PY_DATETIME = {
    # Years
    "YYYY": "%Y",
    "yyyy": "%Y",
    "YY": "%y",
    "yy": "%y",
    # Months
    "MMMM": "%B",   # full month name
    "MMM": "%b",    # short month name
    "MM": "%m",     # zero-padded month
    # Days
    "DDDD": "%j",   # day of year (if used)
    "dddd": "%j",   # day of year (if used)
    "DD": "%d",     # zero-padded day of month
    "dd": "%d",     # zero-padded day of month
    # Hours
    "HH": "%H",     # 24-hour, zero-padded
    "hh": "%H",     # 12-hour, zero-padded => converted to 24-hour
    # Minutes / seconds / subseconds
    "mm": "%M",
    "ss": "%S",
}
def _format_js_datetime(datetime_format:str):
    global JS_TO_PY_DATETIME
    for k,v in JS_TO_PY_DATETIME.items():
        datetime_format = datetime_format.replace(k,v)
    return datetime.datetime.now().strftime(datetime_format)

# Documents, for the description of every node formatting its text through
# _replace_parameters(), the two syntaxes handled below.
PREFIX_SUFFIX_PARAMETER_DOC = """
    A parameter can carry a prefix and/or a suffix: '*' separates the prefix from
    the parameter name, '#' separates the parameter name from the suffix. Both
    characters are reserved and cannot be used in a parameter name. With
    char='Mario':
        'filename%_*char%'    prefix '_'              gives 'filename_Mario'
        'filename%char#-%'    suffix '-'              gives 'filenameMario-'
        'filename%_*char#-%'  prefix '_', suffix '-'  gives 'filename_Mario-'
    A prefix and a suffix are written out only along with a non-empty value, so
    all three give plain 'filename' when char is undefined or empty: an unused
    parameter takes its own separators away with it."""

DATE_PARAMETER_DOC = """
    The parameter name 'date:<format>' is reserved: it is not looked up in the
    dictionary, but replaced with the current date/time rendered with <format>.
    For instance '%%date:YYYY-MM-DD%%' gives a text such as '2026-09-09'.
    The placeholders recognised in <format> are:
        YYYY, yyyy  4-digit year        MMMM  month name (January)
        YY, yy      2-digit year        MMM   short month name (Jan)
        DD, dd      day of the month    MM    month number
        DDDD, dddd  day of the year     HH    hour (24-hour clock)
        mm          minutes             ss    seconds
    'hh' is accepted as well, but it is a 24-hour clock too, not a 12-hour one.
    Any other character of <format> is kept as it is, so it can be used as a
    separator ('%%date:YYYY_MM_DD-HH.mm%%')."""

def _split_marker(match:str):
    """Split the content of a marker, i.e. what sits between the '%' (or '%%')
    delimiters, into its (prefix, name, suffix): 'prefix*name#suffix', both
    separators being optional. '*' and '#' are reserved and cannot be used in a
    parameter name, which makes the three parts unambiguous."""

    (prefix, star, rest) = match.partition("*")
    if star == "":
        (prefix, rest) = ("", match)

    (name, _, suffix) = rest.partition("#")

    return (prefix, name, suffix)

def _resolve_parameter(match:str, parameters:dict):
    """Render the content of a marker. The prefix and the suffix are written out
    only along with a non-empty value, so a marker whose parameter is missing
    leaves nothing behind, separators included."""

    (prefix, name, suffix) = _split_marker(match)

    if name.startswith("date:"):
        value = _format_js_datetime(name[5:])
    else:
        value = parameters.get(name, "")

    return "" if value == "" else prefix + value + suffix

def _replace_parameters(text:str, parameters:dict):
    # replace double % first
    # pattern = r'%%([^%]+)%%'
    # matches = re.findall(pattern, text)
    # for match in matches:
    #     text = text.replace(f"%%{match}%%", _resolve_parameter(match, parameters))

    # replace single % next
    pattern = r'%([^%]+)%'
    matches = re.findall(pattern, text)
    for match in matches:
        text = text.replace(f"%{match}%", _resolve_parameter(match, parameters))

    return text

class ReplaceTextParameters(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ReplaceTextParameters",
            display_name=f"{ADDON_PREFIX} Replace Text Parameters",
            description=f"""
    Replace text parameters.
    The parameters must be in the form '%%name%%' or '%name%'
    For instance, if text='in the style of %%artist%%'
    and parameters contains an entry 'artist': 'anime'
    then the returned text will be 'in the style of anime'
    If the parameter name is not found in the dictionary, it will be replaced with an empty string.{PREFIX_SUFFIX_PARAMETER_DOC}{DATE_PARAMETER_DOC}
    A multiline text is treated as a list of path segments: each line is formatted
    and stripped on its own, blank results are dropped, and the remaining pieces
    are joined with the path separator of the operating system.
    """,
            category=f"{ADDON_CATEGORY}/text",
            inputs=[
                io.String.Input("text", multiline=True, default=""),
                DICT_TYPE.Input("parameters", optional=True),
            ],
            outputs=[
                io.String.Output("text"),
            ],
        )

    @classmethod
    def execute(cls, text, parameters=None):

        if parameters is None:
            parameters = {}

        # Each line is formatted and stripped on its own; the pieces that are
        # left after dropping the blank ones are joined as path segments.
        pieces = [_replace_parameters(line, parameters).strip() for line in text.splitlines()]
        result = os.sep.join(piece for piece in pieces if piece != "")

        return io.NodeOutput(result, ui=ui.PreviewText(result))

class FileNameTemplate(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        autogrow_template = io.Autogrow.TemplatePrefix(
            input=io.AnyType.Input("p"),  # template for each input
            prefix="p",                   # prefix for generated input names
            min=1,                        # minimum number of inputs shown
            max=10,                       # maximum number of inputs allowed
        )
        return io.Schema(
            node_id=f"{ADDON_PREFIX}FileNameTemplate",
            display_name=f"{ADDON_PREFIX} File Name From Template",
            description=f"""
    Build a file name by replacing the parameters of a template.
    The parameters must be in the form '%%name%%' or '%name%', and are taken from
    opt_textparams, from the connected inputs p0, p1, ... (as '%%p0%%', '%%p1%%', ...)
    and, when model_name is given, from its file name stem, truncated to
    model_name_max_length and with the spaces replaced by '_' (as '%%model_name%%').
    A parameter which is not found is replaced with an empty string, and the
    doubled path separators of the result are collapsed into a single one.{PREFIX_SUFFIX_PARAMETER_DOC}{DATE_PARAMETER_DOC}
    """,
            category=f"{ADDON_CATEGORY}/text",
            inputs=[
                io.String.Input("template", default=""),
                io.Autogrow.Input("params", template=autogrow_template),
                io.String.Input("model_name", default=""),
                io.Int.Input("model_name_max_length", default=100),
                DICT_TYPE.Input("opt_textparams", optional=True)
            ],
            outputs=[io.String.Output("filename")],
        )

    @classmethod
    def execute(cls, template, params: io.Autogrow.Type, model_name, model_name_max_length, opt_textparams=None) -> io.NodeOutput:
        param_list = list(params.values())

        opt_textparams = {} if opt_textparams is None else clone_data(opt_textparams)

        model_name = model_name.strip()
        if model_name != "":
            opt_textparams["model_name"] = Path(model_name).stem[:model_name_max_length].replace(" ", "_")

        for i in range(0, len(param_list)):
            opt_textparams[f"p{i}"] = param_list[i]

        filename = _replace_parameters(template, opt_textparams)

        # remove doubles
        filename = filename.replace("\\\\", "\\")
        filename = filename.replace("//", "/")

        return io.NodeOutput(filename)

class PromptChainer(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}PromptChainer",
            display_name=f"{ADDON_PREFIX} Prompt Chainer",
            category=f"{ADDON_CATEGORY}/text",
            inputs=[
                io.String.Input("prompt", multiline=True, dynamic_prompts=True, default=""),
                io.String.Input("prev_prompt", multiline=True, dynamic_prompts=True, default="",
                                optional=True, force_input=True),
            ],
            outputs=[
                io.String.Output("prompt"),
            ],
        )

    @classmethod
    def execute(cls, prompt, prev_prompt=None):
        if prev_prompt is None:
            return io.NodeOutput(prompt)
        else:
            return io.NodeOutput(prev_prompt + "\n" + prompt)

class DoublePrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}DoublePrompt",
            display_name=f"{ADDON_PREFIX} Double Prompt",
            description="""
    Two multiline prompt fields (positive and negative), returned unchanged.
    Drag the divider between the two fields to change how the node height is
    shared between them (double-click the divider to restore the even split).
    """,
            category=f"{ADDON_CATEGORY}/text",
            inputs=[
                io.String.Input("prompt_positive", multiline=True, dynamic_prompts=True, default=""),
                io.String.Input("prompt_negative", multiline=True, dynamic_prompts=True, default=""),
            ],
            outputs=[
                io.String.Output("prompt_positive"),
                io.String.Output("prompt_negative"),
            ],
        )

    @classmethod
    def execute(cls, prompt_positive, prompt_negative):
        return io.NodeOutput(prompt_positive, prompt_negative)

class ComplexPrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ComplexPrompt",
            display_name=f"{ADDON_PREFIX} Complex Prompt",
            description=f"""
    Performs a series of actions:
    - concatenate the prompts
    - replace text parameters
    - extract loras from positive prompt and add them to the lora stack
    - return final clean prompts and lora stack
    The text parameters must be in the form '%%name%%' or '%name%', and a parameter
    which is not found in text_params is replaced with an empty string.{PREFIX_SUFFIX_PARAMETER_DOC}{DATE_PARAMETER_DOC}
    """,
            category=f"{ADDON_CATEGORY}/text",
            inputs=[
                io.Autogrow.Input("prompt_positives", optional=True, template=io.Autogrow.TemplatePrefix(
                    input=io.String.Input("prompt"),
                    prefix="prompt_positive_",      
                    min=0,                          
                    max=10,                         
                )),
                io.Autogrow.Input("prompt_negatives", optional=True, template=io.Autogrow.TemplatePrefix(
                    input=io.String.Input("prompt"),
                    prefix="prompt_negative_",      
                    min=0,                          
                    max=10,                         
                )),
                LORA_STACK_TYPE.Input("lora_stack", optional=True),
                DICT_TYPE.Input("text_params", optional=True),
            ],
            outputs=[
                io.String.Output("prompt_positive"),
                io.String.Output("prompt_negative"),
                LORA_STACK_TYPE.Output("lora_stack"),
                DICT_TYPE.Output("text_params"),
            ],
        )

    @classmethod
    def execute(cls, prompt_positives: io.Autogrow.Type=None, prompt_negatives: io.Autogrow.Type=None, lora_stack=None, text_params=None):

        lora_stack = [] if lora_stack is None else clone_data(lora_stack)
        text_params = {} if text_params is None else clone_data(text_params)

        # join the positive prompts and replace parameters
        prompt_positive = ""
        if prompt_positives is not None:
            for prompt in list(prompt_positives.values()):
                if prompt != "":
                    prompt_positive += prompt + "\n"
            prompt_positive = _replace_parameters(prompt_positive, text_params).strip()

        # join the negative prompts and replace parameters
        prompt_negative = ""
        if prompt_negatives is not None:
            for prompt in list(prompt_negatives.values()):
                if prompt != "":
                    prompt_negative += prompt + "\n"
            prompt_negative = _replace_parameters(prompt_negative, text_params).strip()

        # extract loras from positive prompt and add them to the stack
        (clean_prompt_positive, final_lora_stack) = ConvertLoraStringToStack.execute(prompt_positive, lora_stack).result

        return io.NodeOutput(clean_prompt_positive, prompt_negative, final_lora_stack, text_params)

class TextConcat(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}TextConcat",
            display_name=f"{ADDON_PREFIX} Text Concat",
            description="""
    Concatenate up to 10 prompts into a single prompt.
    Missing (unconnected) inputs count as empty strings, each prompt is stripped
    of its leading/trailing whitespace, and empty prompts are skipped.
    comma_separator / newline_separator insert a ',' and/or a newline between the
    prompts, unless the text already ends with that separator.
    """,
            category=f"{ADDON_CATEGORY}/text",
            inputs=[
                io.Autogrow.Input("prompts", optional=True, template=io.Autogrow.TemplatePrefix(
                    input=io.String.Input("prompt", optional=True),   # optional: unconnected slots are allowed
                    prefix="prompt_",
                    min=2,
                    max=10,
                )),
                io.Boolean.Input("comma_separator", default=True),
                io.Boolean.Input("newline_separator", default=True),
            ],
            outputs=[
                io.String.Output("prompt"),
            ],
        )

    @classmethod
    def execute(cls, prompts: io.Autogrow.Type=None, comma_separator=False, newline_separator=False):

        result = ""
        for prompt in ([] if prompts is None else list(prompts.values())):
            prompt = "" if prompt is None else str(prompt).strip()
            if prompt == "":
                continue

            if result != "":
                if comma_separator and not result.endswith(","):
                    result += ","
                if newline_separator and not result.endswith("\n"):
                    result += "\n"

            result += prompt

        return io.NodeOutput(result)


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        ReplaceTextParameters,
        FileNameTemplate,
        PromptChainer,
        DoublePrompt,
        ComplexPrompt,
        TextConcat,
    ]
