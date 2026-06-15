from comfy_api.latest import ComfyExtension, io

import folder_paths

import shutil
from pathlib import Path
from typing_extensions import override

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY, SETTINGS_DIR, MODELS_DIR
from .logging import logger
from .utils import LORA_STACK_TYPE
from ..scripts.download_models import download_models_from_text_list

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
            display_name=f"{ADDON_PREFIX} DownloadModelsList",
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
            display_name=f"{ADDON_PREFIX} IsNull",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.AnyType.Input("value", optional=True),
            ],
            outputs=[
                io.Boolean.Output("isNull")
            ]
        )

    @classmethod
    def execute(cls, value=None) -> io.NodeOutput:
        return io.NodeOutput(value == None)

# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        SwitchAny,
        CollectModelNtxdata,
        #CLIPTextEncodeWithCutoff,
        DownloadModelsList,
        IsNull,
    ]
