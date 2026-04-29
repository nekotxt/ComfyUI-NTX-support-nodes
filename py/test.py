from comfy_api.latest import ComfyExtension, io, ui

from ..config_variables import ADDON_NAME, ADDON_PREFIX, ADDON_CATEGORY
from .utils import clone_data, DICT_TYPE

class SwitchNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        # Create a template - all inputs/outputs sharing the same template will match types
        template = io.MatchType.Template("switch", allowed_types=[io.Image, io.Mask, io.Latent])
        return io.Schema(
            node_id=f"{ADDON_PREFIX}SwitchNode",
            display_name=f"{ADDON_PREFIX} SwitchNode",
            category=f"{ADDON_CATEGORY}/test",
            inputs=[
                io.Boolean.Input("switch"),
                io.MatchType.Input("on_false", template=template, lazy=True),
                io.MatchType.Input("on_true", template=template, lazy=True),
            ],
            outputs=[
                io.MatchType.Output(template=template, display_name="output"),
            ],
        )

    @classmethod
    def execute(cls, switch, on_false, on_true) -> io.NodeOutput:
        # Return with optional UI preview
        return io.NodeOutput(on_true if switch else on_false)

class AutogrowNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        autogrow_template = io.Autogrow.TemplatePrefix(
            input=io.Image.Input("image"),  # template for each input
            prefix="image",                  # prefix for generated input names
            min=2,                           # minimum number of inputs shown
            max=50,                          # maximum number of inputs allowed
        )
        return io.Schema(
            node_id=f"{ADDON_PREFIX}BatchImagesNode",
            display_name=f"{ADDON_PREFIX} Batch Images",
            category=f"{ADDON_CATEGORY}/test",
            inputs=[io.Autogrow.Input("images", template=autogrow_template)],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, images: io.Autogrow.Type) -> io.NodeOutput:
        # 'images' is a dict mapping input names to their values
        image_list = list(images.values())
        return io.NodeOutput(image_list[-1])

class DynamicComboNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}ResizeNode",
            display_name=f"{ADDON_PREFIX} Resize",
            category=f"{ADDON_CATEGORY}/test",
            inputs=[
                io.Image.Input("image"),
                io.DynamicCombo.Input("resize_type", options=[
                    io.DynamicCombo.Option("scale by dimensions", [
                        io.Int.Input("width", default=512, min=0, max=8192),
                        io.Int.Input("height", default=512, min=0, max=8192),
                    ]),
                    io.DynamicCombo.Option("scale by multiplier", [
                        io.Float.Input("multiplier", default=1.0, min=0.01, max=8.0),
                    ]),
                    io.DynamicCombo.Option("scale to megapixels", [
                        io.Float.Input("megapixels", default=1.0, min=0.01, max=16.0),
                    ]),
                ]),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, resize_type: dict) -> io.NodeOutput:
        # resize_type is a dict containing the selected option key and its inputs
        selected = resize_type["resize_type"]
        if selected == "scale by dimensions":
            width = resize_type["width"]
            height = resize_type["height"]
            # ...
        elif selected == "scale by multiplier":
            multiplier = resize_type["multiplier"]
            # ...
        return io.NodeOutput(image, ui=ui.PreviewImage(image, cls=cls))

class DynamicTwinNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        dyn_options = []
        for i in range(1,10+1):
            entry_options = []
            for j in range(1,i+1):
                entry_options.append(io.String.Input(f"name{j}", default=""))
                entry_options.append(io.AnyType.Input(f"value{j}"))
            dyn_options.append(io.DynamicCombo.Option(str(i), entry_options))

        return io.Schema(
            node_id=f"{ADDON_PREFIX}DynamicTwinNode",
            display_name=f"{ADDON_PREFIX} DynamicTwinNode",
            category=f"{ADDON_CATEGORY}/test",
            inputs=[
                DICT_TYPE.Input("dict_in"),
                io.DynamicCombo.Input("inputs", options=dyn_options),
            ],
            outputs=[
                DICT_TYPE.Output("dict_out")
            ],
        )

    @classmethod
    def execute(cls, dict_in, inputs: dict) -> io.NodeOutput:
        pipe = {} if dict_in is None else clone_data(dict_in)

        n = int(inputs.get("inputs", 0))
        for j in range(1, n+1):
            name = inputs.get(f"name{j}", "")
            if name != "":
                value = inputs.get(f"value{j}", None)
                if value is None:
                    if name in pipe:
                        del pipe[name]
                else:
                    pipe[name] = value

        return io.NodeOutput(pipe)

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [SwitchNode, AutogrowNode, DynamicComboNode, DynamicTwinNode]
