// CREATED WITH CLAUDE
//
// Smaller minimum width for the reroute nodes (py/reroutes.py).
//
// litegraph clamps interactive node resizing to computeSize(), whose width
// floor is max(title width, slot label widths, LiteGraph.NODE_WIDTH = 140) —
// far wider than a reroute node needs. Each reroute node instance gets a
// computeSize() override that caps the returned width at MIN_WIDTH, so the
// user can drag the node down to that width (the height floor is unchanged).
//
// The override is installed in the nodeCreated hook, which runs *after*
// ComfyUI's setInitialSize(), so freshly added nodes still spawn at their
// normal size. Note that computeSize() doubles as the "fit" size: the native
// RMB "Resize" action now snaps a reroute node to the minimal width.

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_PREFIX = ADDON_PREFIX + "Reroute";   // every reroute node id starts with this
const MIN_WIDTH = 80;

const isReroute = (node) =>
    typeof node?.comfyClass === "string" && node.comfyClass.startsWith(NODE_PREFIX);

function installMinSizeHook(node) {
    if (node.__rerouteMinSize) return;
    node.__rerouteMinSize = true;
    const orig = node.computeSize;
    node.computeSize = function (out) {
        const size = orig.apply(this, arguments);
        size[0] = Math.min(size[0], MIN_WIDTH);
        return size;
    };
}

app.registerExtension({
    name: API_PREFIX + ".reroutes.min_size",

    nodeCreated(node) {
        if (isReroute(node)) installMinSizeHook(node);
    },
});
