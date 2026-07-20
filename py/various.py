from comfy_api.latest import ComfyExtension, io, ui

import folder_paths

import json
import shutil
import torch
from pathlib import Path
from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, SETTINGS_DIR, MODELS_DIR
from .logging import logger
from .utils import LORA_STACK_TYPE, notify_user
from ..scripts.ms_download_models import download_models_from_text_list

# ===== NODES ==============================================================================================================================

class SwitchAny(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SwitchAny",
            display_name=f"{ADDON_PREFIX} Switch Any",
            description="Return the first non-null input, or None if all inputs are missing",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.AnyType.Input("input1", optional=True),
                io.AnyType.Input("input2", optional=True),
                io.AnyType.Input("input3", optional=True),
                io.AnyType.Input("input4", optional=True),
                io.AnyType.Input("input5", optional=True),
            ],
            outputs=[
                io.AnyType.Output("output"),
            ],
        )

    @classmethod
    def execute(cls, input1=None, input2=None, input3=None, input4=None, input5=None):
        if input1 is not None:
            return io.NodeOutput(input1)
        if input2 is not None:
            return io.NodeOutput(input2)
        if input3 is not None:
            return io.NodeOutput(input3)
        if input4 is not None:
            return io.NodeOutput(input4)
        return io.NodeOutput(input5)

class SelectAnyInput(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        autogrow_template = io.Autogrow.TemplatePrefix(
            input=io.AnyType.Input("input"),  # template for each input
            prefix="input",                  # prefix for generated input names
            min=2,                           # minimum number of inputs shown
            max=50,                          # maximum number of inputs allowed
        )
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SelectAnyInput",
            display_name=f"{ADDON_PREFIX} Select Any",
            description="Return the selected item",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Autogrow.Input("inputs", template=autogrow_template),
                io.Int.Input("select", default=1, min=1, max=4096, step=1),
            ],
            outputs=[io.AnyType.Output("output")],
        )

    @classmethod
    def execute(cls, inputs: io.Autogrow.Type, select) -> io.NodeOutput:
        # 'inputs' is a dict mapping input names to their values
        inputs_list = list(inputs.values())
        if select < 0:
            select = 0
        if select >= len(inputs_list):
            select = len(inputs_list) - 1
        return io.NodeOutput(inputs_list[select])

class LazySelectAny(io.ComfyNode):
    MAX_INPUTS = 5

    @classmethod
    def define_schema(cls):
        slots = [
            io.AnyType.Input(f"input{i}", optional=True, lazy=True)
            for i in range(cls.MAX_INPUTS)
        ]
        return io.Schema(
            node_id=f"{ADDON_PREFIX}LazySelectAny",
            display_name=f"{ADDON_PREFIX} Lazy Select Any",
            description="Return the selected item (do not execute the unselected branches)",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Int.Input("select", default=0, min=0, max=cls.MAX_INPUTS - 1, step=1),
                *slots,
            ],
            outputs=[
                io.AnyType.Output("output"),
                io.Int.Output("select"),
            ],
        )

    @classmethod
    def check_lazy_status(cls, select, **kwargs):
        key = "input%d" % select
        if kwargs.get(key, None) is None:
            return [key]
        return []

    @classmethod
    def execute(cls, select, **kwargs) -> io.NodeOutput:
        return io.NodeOutput(kwargs.get("input%d" % select), select)

class LazySelectAny15(LazySelectAny):
    MAX_INPUTS = 15

class PreviewAsText(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}PreviewAsText",
            display_name=f"{ADDON_PREFIX} Preview as Text",
            description="Preview any value as text, like the core 'Preview as Text' node, "
                        "but not an output node: it only runs when a downstream node needs its output.",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.AnyType.Input("source"),
            ],
            outputs=[
                io.String.Output("text"),
            ],
        )

    @classmethod
    def execute(cls, source=None):
        torch.set_printoptions(edgeitems=6)
        value = 'None'
        if isinstance(source, str):
            value = source
        elif isinstance(source, (int, float, bool)):
            value = str(source)
        elif source is not None:
            try:
                value = json.dumps(source, indent=4)
            except Exception:
                try:
                    value = str(source)
                except Exception:
                    value = 'source exists, but could not be serialized.'

        torch.set_printoptions()
        return io.NodeOutput(value, ui=ui.PreviewText(value))

class PreviewImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}PreviewImage",
            display_name=f"{ADDON_PREFIX} Preview Image",
            description="Preview images, like the core 'Preview Image' node, "
                        "but not an output node: it only runs when a downstream node needs its output.",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Image.Input("images"),
            ],
            outputs=[
                io.Image.Output("images"),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
        )

    @classmethod
    def execute(cls, images):
        return io.NodeOutput(images, ui=ui.PreviewImage(images, cls=cls))

class CollectModelNtxdata(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}CollectModelNtxdata",
            display_name=f"{ADDON_PREFIX} Collect Model Ntxdata",
            description="",
            category=f"{ADDON_CATEGORY}/utils",
            is_output_node=True,
            inputs=[
                io.AnyType.Input("ckpt_name", optional=True),
                LORA_STACK_TYPE.Input("lora_stack", optional=True),
            ],
            outputs=[],
        )

    @classmethod
    def execute(cls, ckpt_name=None, lora_stack=None):

        models_list = []

        if ckpt_name is not None:
            models_list.append(folder_paths.get_full_path_or_raise("checkpoints", ckpt_name))

        if lora_stack is not None:
            for (lora_name, _, _) in lora_stack:
                models_list.append(folder_paths.get_full_path_or_raise("loras", lora_name))

        global SETTINGS_DIR
        download_dir = SETTINGS_DIR / "downloads"
        download_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Copy to {download_dir}")

        for model_name in models_list:
            model_path = Path(model_name)
            datafile_path = model_path.with_suffix('.ntxdata')
            if datafile_path.is_file():
                shutil.copy(datafile_path, download_dir / datafile_path.name)
                logger.info(f"- copied {datafile_path}")
            else:
                logger.warning(f"- not found! {model_name}")

        return io.NodeOutput()

class CLIPTextEncodeWithCutoff(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=f"{ADDON_PREFIX}CLIPTextEncodeWithCutoff",
            display_name=f"{ADDON_PREFIX} CLIPTextEncodeWithCutoff",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input("prompt",
                    default="",
                    multiline=True
                ),
            ],
            outputs=[
                io.Conditioning.Output("conditioning")
            ]
        )

    @classmethod
    def execute(cls, clip, prompt) -> io.NodeOutput:
        from nodes import CLIPTextEncode, ConditioningConcat

        if "BREAK" in prompt:
            prompts = prompt.split("BREAK")
            print(f"Conditioning 0 : {prompts[0]}")
            (conditioning,) = CLIPTextEncode().encode(clip=clip, text=prompts[0])
            for i in range(1,len(prompts)):
                print(f"Conditioning {i} : {prompts[i]}")
                (conditioning_to,) = CLIPTextEncode().encode(clip=clip, text=prompts[i])
                (conditioning,) = ConditioningConcat().concat(conditioning_to=conditioning_to, conditioning_from=conditioning)
            return io.NodeOutput(conditioning)
        else:
            print(f"Conditioning all : {prompt}")
            (conditioning,) = CLIPTextEncode().encode(clip=clip, text=prompt)
            return io.NodeOutput(conditioning)

class DownloadModelsList(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}DownloadModelsList",
            display_name=f"{ADDON_PREFIX} Download Models List",
            description="",
            category=f"{ADDON_CATEGORY}/utils",
            is_output_node=True,
            inputs=[
                io.String.Input("models_list", multiline=True, dynamic_prompts=False, default=""),
                io.String.Input("models_dir", multiline=False, dynamic_prompts=False, default=""),
                io.String.Input("civitai_api_key", multiline=False, dynamic_prompts=False, default=""),
            ],
            outputs=[
                io.String.Output("result")
            ],
        )

    @classmethod
    def execute(cls, models_list="", models_dir="", civitai_api_key=""):
        if models_dir == "":
            global MODELS_DIR
            models_dir = MODELS_DIR

        logger.info("Attempt to download models:")
        logger.info(f"- models dir: {models_dir}")
        logger.info(f"- civitai api key: {str(len(civitai_api_key)*'*')}")

        result = download_models_from_text_list(text=models_list, models_dir=str(models_dir), tokens={"civitai": civitai_api_key})

        return io.NodeOutput(result)

class IsNull(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=f"{ADDON_PREFIX}IsNull",
            display_name=f"{ADDON_PREFIX} Is Null",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.AnyType.Input("value", optional=True),
            ],
            outputs=[
                io.Boolean.Output("is_null")
            ]
        )

    @classmethod
    def execute(cls, value=None) -> io.NodeOutput:
        return io.NodeOutput(value == None)

class IsEmpty(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=f"{ADDON_PREFIX}IsEmpty",
            display_name=f"{ADDON_PREFIX} Is Empty",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.AnyType.Input("value", optional=True),
            ],
            outputs=[
                io.Boolean.Output("is_empty")
            ]
        )

    @classmethod
    def execute(cls, value=None) -> io.NodeOutput:
        if value == None:
            io.NodeOutput(True)
        if isinstance(value, (str)):
            return io.NodeOutput(value.strip() == "")
        if isinstance(value, (list, tuple, dict)):
            return io.NodeOutput(len(value) == 0)
        return io.NodeOutput(False)

class CheckNotNull(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id=f"{ADDON_PREFIX}CheckNotNull",
            display_name=f"{ADDON_PREFIX} Check Not Null",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.AnyType.Input("value"),
                io.String.Input("error_message"),
            ],
            outputs=[
                io.Boolean.Output("is_not_null")
            ]
        )

    @classmethod
    def execute(cls, value, error_message) -> io.NodeOutput:
        if value == None:
            logger.warning(f"CheckNotNull : {error_message}")
            notify_user("warn", "CheckNotNull", error_message)
            return io.NodeOutput(False)
        else:
            return io.NodeOutput(True)

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        SwitchAny,
        SelectAnyInput,
        LazySelectAny,
        LazySelectAny15,
        PreviewAsText,
        PreviewImage,
        CollectModelNtxdata,
        #CLIPTextEncodeWithCutoff,
        DownloadModelsList,
        IsNull,
        IsEmpty,
        CheckNotNull,
    ]
