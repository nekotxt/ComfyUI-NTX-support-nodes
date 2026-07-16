// CREATED WITH CLAUDE
//
// Repositionable slots for the reroute nodes (py/reroutes.py).
//
// Each reroute node has exactly one input and one output slot. By default
// litegraph puts the input on the left edge and the output on the right edge;
// this module lets the user move each of them to any of the four node sides
// (left / right / top / bottom), with the constraint that the input and the
// output never share a side.
//
// The chosen sides are stored in node.properties (input_side / output_side),
// so they serialize with the workflow; the properties are dropped again when
// the user returns to the standard left/right layout. Rendering relies on two
// per-slot litegraph fields the frontend honours everywhere (position,
// hit-testing and link routing):
//   - slot.pos — hard-coded slot centre, relative to the node's top-left
//   - slot.dir — LinkDirection the wire leaves/enters the slot with
// Positions depend on the node size, so they are recomputed on resize.
//
// The user picks the layout from a single "Slot sides" submenu added to the
// node's RMB menu through menu.js, listing every input→output combination
// ("Left to Right", "Left to Top", ...).

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";

const NODE_PREFIX = ADDON_PREFIX + "Reroute";   // every reroute node id starts with this
const PROP_INPUT = "input_side";
const PROP_OUTPUT = "output_side";
const SIDES = ["left", "right", "top", "bottom"];
const OPPOSITE = { left: "right", right: "left", top: "bottom", bottom: "top" };
const DEFAULTS = { input: "left", output: "right" };

const isReroute = (node) =>
    typeof node?.comfyClass === "string" && node.comfyClass.startsWith(NODE_PREFIX);

// direction a wire points at a slot sitting on `side`
function sideDir(side) {
    switch (side) {
        case "top": return LiteGraph.UP;
        case "bottom": return LiteGraph.DOWN;
        case "right": return LiteGraph.RIGHT;
        default: return LiteGraph.LEFT;
    }
}

// slot centre for `side`, relative to the node's top-left corner, using the
// same edge inset as litegraph's default slot layout
function slotPoint(node, side) {
    const [w, h] = node.size;
    const inset = LiteGraph.NODE_SLOT_HEIGHT * 0.5;
    switch (side) {
        case "top": return [w * 0.5, inset];
        case "bottom": return [w * 0.5, h - inset];
        case "right": return [w + 1 - inset, h * 0.5];
        default: return [inset, h * 0.5];
    }
}

// Current sides of a node, validated: unknown values fall back to the
// defaults and an input/output collision (hand-edited workflow) is resolved
// by pushing the output to the opposite side.
function getSides(node) {
    const props = node.properties ?? {};
    const input = SIDES.includes(props[PROP_INPUT]) ? props[PROP_INPUT] : DEFAULTS.input;
    let output = SIDES.includes(props[PROP_OUTPUT]) ? props[PROP_OUTPUT] : DEFAULTS.output;
    if (output === input) output = OPPOSITE[input];
    return { input, output };
}

// (Re)apply the configured sides to the slot objects. Without the properties
// any custom pos/dir is removed, restoring litegraph's default layout.
function applySides(node) {
    const props = node.properties;
    const custom = !!props && (PROP_INPUT in props || PROP_OUTPUT in props);
    const { input, output } = getSides(node);

    for (const slot of node.inputs ?? []) {
        if (custom) {
            slot.pos = slotPoint(node, input);
            slot.dir = sideDir(input);
        } else {
            delete slot.pos;
            delete slot.dir;
        }
    }
    for (const slot of node.outputs ?? []) {
        if (custom) {
            slot.pos = slotPoint(node, output);
            slot.dir = sideDir(output);
        } else {
            delete slot.pos;
            delete slot.dir;
        }
    }
    node.setDirtyCanvas?.(true, true);   // links are drawn on the background canvas
}

function setSides(node, input, output) {
    if (!SIDES.includes(input) || !SIDES.includes(output) || input === output) return;

    node.properties ??= {};
    if (input === DEFAULTS.input && output === DEFAULTS.output) {
        // back to the standard layout — keep the workflow JSON clean
        delete node.properties[PROP_INPUT];
        delete node.properties[PROP_OUTPUT];
    } else {
        node.properties[PROP_INPUT] = input;
        node.properties[PROP_OUTPUT] = output;
    }
    applySides(node);
}

// slot positions depend on the node size — track resizes per instance
function installResizeHook(node) {
    if (node.__slotSidesResizeHook) return;
    node.__slotSidesResizeHook = true;
    const orig = node.onResize;
    node.onResize = function () {
        const r = orig?.apply(this, arguments);
        const props = this.properties;
        if (props && (PROP_INPUT in props || PROP_OUTPUT in props)) applySides(this);
        return r;
    };
}

// RMB entry: a single submenu listing every valid input→output combination
// ("Left to Right", "Left to Top", ...), with the current one checked.
registerNodeMenu((node) => {
    if (!isReroute(node)) return [];
    const sides = getSides(node);
    const cap = (s) => s[0].toUpperCase() + s.slice(1);

    const options = [];
    for (const input of SIDES) {
        for (const output of SIDES) {
            if (output === input) continue;
            const current = input === sides.input && output === sides.output;
            options.push({
                content: (current ? "✓ " : "") + `${cap(input)} to ${cap(output)}`,
                callback: () => setSides(node, input, output),
            });
        }
    }

    return [{ content: "Slot sides", has_submenu: true, submenu: { options } }];
});

app.registerExtension({
    name: API_PREFIX + ".reroutes.slot_sides",

    nodeCreated(node) {
        if (isReroute(node)) installResizeHook(node);
    },

    // Runs after configure() on every graph (re)load: re-derives the slot
    // layout from the properties (and clears any stale serialized slot.pos
    // when the properties are absent).
    loadedGraphNode(node) {
        if (isReroute(node)) applySides(node);
    },
});
