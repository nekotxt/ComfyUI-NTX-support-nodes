from comfy_api.latest import io

from ..config_variables import ADDON_PREFIX, ADDON_CATEGORY
from .logging import logger

# ===== NODES ==============================================================================

# upper bound for the seed value; matches the standard ComfyUI seed range
SEED_MAX = 0xFFFFFFFFFFFFFFFF


class RandomSeed(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=f"{ADDON_PREFIX}RandomSeed",
            display_name=f"{ADDON_PREFIX} Random Seed",
            description="Holds a single integer seed and reflects it as an output. "
                        "Use the 'New random seed' button on the node to randomise it.",
            category=f"{ADDON_CATEGORY}/utils",
            inputs=[
                io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=False),
            ],
            outputs=[
                io.Int.Output("seed"),
            ],
        )

    @classmethod
    def execute(cls, seed):
        logger.info(f"RandomSeed reflecting seed={seed}")
        return io.NodeOutput(seed)


# ===== INITIALIZATION =====================================================================

def get_nodes_list() -> list[type[io.ComfyNode]]:
    return [
        RandomSeed,
    ]
