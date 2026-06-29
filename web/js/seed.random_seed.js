// CREATED WITH CLAUDE

import { app } from "../../../scripts/app.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_ID = ADDON_PREFIX + "RandomSeed";
const SEED_WIDGET = "seed";

// must match SEED_MAX in py/seed.py (0xFFFFFFFFFFFFFFFF). JS numbers can't hold
// the full 64-bit range exactly, so we draw from the safe-integer space, which is
// plenty random for a seed and round-trips cleanly through the INT widget.
const SEED_MAX = Number.MAX_SAFE_INTEGER;

function randomSeed() {
    return Math.floor(Math.random() * SEED_MAX);
}

app.registerExtension({
    name: API_PREFIX + ".seed.random_seed",

    async nodeCreated(node) {
        if (node.comfyClass !== NODE_ID) return;

        const seedWidget = node.widgets?.find((w) => w.name === SEED_WIDGET);
        if (!seedWidget) return;

        node.addWidget("button", "New random seed", null, () => {
            seedWidget.value = randomSeed();
            seedWidget.callback?.(seedWidget.value);
            node.setDirtyCanvas(true, true);
        });
    },
});
