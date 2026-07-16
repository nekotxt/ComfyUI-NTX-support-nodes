"""GlobalSet / GlobalGet - metadata-only backend definitions.

These two nodes are pure FRONTEND virtual nodes; all of their behavior lives in
web/js/global_set_get.js. They are declared here ONLY so the node library shows
a proper display name, category, description and search entry (a pure frontend
node would otherwise show up under "__frontend_only__" with its raw class id).

At run time the frontend marks every instance virtual (isVirtualNode), so
ComfyUI prunes them from the prompt and reroutes every GlobalGet output
straight to the real node feeding the same-named GlobalSet input. These Python
classes are therefore NEVER executed; the empty execute() exists only so the
class is a valid node definition. The frontend registration (registerCustomNodes
runs after the backend defs are registered) replaces the generated class, and
the user-defined slots are created there — which is why no inputs/outputs are
declared here (nothing to reconcile, nothing to re-add).
"""

from comfy_api.latest import io

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY


class GlobalSet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GlobalSet",
            display_name=f"{ADDON_PREFIX} Global Set",
            description=(
                "Store any number of connections under unique names and read them "
                "back anywhere with a Global Get node - wireless wires that keep the "
                "canvas clean. Define the inputs (name + data type) with the "
                "'Edit inputs' button; every name may be defined by only one Global "
                "Set in the whole workflow. The node lives only in the editor: at "
                "run time each value flows straight from its original source, so it "
                "never changes the result or slows anything down."
            ),
            category=f"{ADDON_CATEGORY}/reroute",
            inputs=[],
            outputs=[],
        )

    @classmethod
    def execute(cls, **kwargs):
        return io.NodeOutput()


class GlobalGet(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GlobalGet",
            display_name=f"{ADDON_PREFIX} Global Get",
            description=(
                "Read values stored by Global Set nodes, with no cable. Define the "
                "outputs with the 'Edit outputs' button - only names defined by a "
                "Global Set can be used, and each output takes that entry's data "
                "type. Like Global Set it exists only in the editor and resolves "
                "straight to the original source at run time, so there is no extra "
                "cost. Add as many Global Get nodes as you like to fan values out."
            ),
            category=f"{ADDON_CATEGORY}/reroute",
            inputs=[],
            outputs=[],
        )

    @classmethod
    def execute(cls, **kwargs):
        return io.NodeOutput()


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        GlobalSet,
        GlobalGet,
    ]
