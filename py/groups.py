"""GroupControl - metadata-only backend definition.

This node is a pure FRONTEND virtual node; all of its behavior lives in
web/js/groups.control.js. It is declared here ONLY so the node library shows a
proper display name, category, description and search entry (a pure frontend
node would otherwise show up under "__frontend_only__" with its raw class id).

Groups - and the muted / bypassed state of a node - never reach the backend:
the frontend resolves them while building the prompt (nodes set to NEVER or
BYPASS are simply left out) and execution.py has no notion of a group at all.
The node therefore cannot act at run time; it is a canvas control panel whose
buttons act the moment they are pressed. At run time the frontend marks every
instance virtual (isVirtualNode), so ComfyUI prunes it from the prompt and the
execute() below is NEVER called - it exists only so the class is a valid node
definition.
"""

from comfy_api.latest import io

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY


class GroupControl(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}GroupControl",
            display_name=f"{ADDON_PREFIX} Group Control",
            description=(
                "Mute, bypass, reset or run whole groups of the workflow, picked by "
                "name. The 'groups' widget opens a checklist of every group of the "
                "current graph - tick as many as needed - then Mute, Bypass and Reset "
                "set the mode of every node those groups hold, and Queue runs only "
                "the output nodes they hold, plus whatever feeds them. The node lives "
                "only in the editor: it is pruned from the prompt and never executes, "
                "so it costs nothing and changes no result."
            ),
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[],
            outputs=[],
        )

    @classmethod
    def execute(cls, **kwargs):
        return io.NodeOutput()


# ===== INITIALIZATION =====================================================================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        GroupControl,
    ]
