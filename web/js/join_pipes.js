// CREATED WITH CLAUDE OPUS 4.8

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";

// node_id built backend-side as f"{ADDON_PREFIX}{cls.__name__}" -> e.g. "TESTPipeImageEdit"
const PIPE_NODE_TYPE = [`${ADDON_PREFIX}PipeImageEdit`, `${ADDON_PREFIX}PipeVideoWan`];
// name of the slot that chains the pipe nodes together (both input and output)
const PIPE_SLOT_NAME = "pipe";

// --- small helpers ------------------------------------------------------------

function isPipeNode(node) {
    return !!node && (PIPE_NODE_TYPE.includes(node.type) || PIPE_NODE_TYPE.includes(node.comfyClass));
}

// graph.links is a plain object in old litegraph and a Map in the newer one
function getLink(graph, linkId) {
    if (linkId === null || linkId === undefined) return null;
    const links = graph.links;
    if (!links) return null;
    if (typeof links.get === "function") return links.get(linkId);
    return links[linkId];
}

function findOutputSlot(node, name) {
    if (!node.outputs) return -1;
    return node.outputs.findIndex((o) => o && o.name === name);
}

function findInputSlot(node, name) {
    if (!node.inputs) return -1;
    return node.inputs.findIndex((i) => i && i.name === name);
}

// true if every output slot of the node, except the given one, has no outgoing links
function onlyOutputWithLinks(node, exceptSlot) {
    if (!node.outputs) return true;
    for (let i = 0; i < node.outputs.length; i++) {
        if (i === exceptSlot) continue;
        const out = node.outputs[i];
        if (out && out.links && out.links.length > 0) return false;
    }
    return true;
}

// true if every input slot of the node, except the given one, has no incoming link
function onlyInputWithLink(node, exceptSlot) {
    if (!node.inputs) return true;
    for (let i = 0; i < node.inputs.length; i++) {
        if (i === exceptSlot) continue;
        const inp = node.inputs[i];
        if (inp && inp.link !== null && inp.link !== undefined) return false;
    }
    return true;
}

// --- core ---------------------------------------------------------------------

// Look for a valid (source, target) pair among the given nodes.
// Returns { source, target, srcPipeOut } or null.
function findPipePair(graph, nodes) {
    for (const target of nodes) {
        if (!isPipeNode(target)) continue;

        const tgtPipeIn = findInputSlot(target, PIPE_SLOT_NAME);
        if (tgtPipeIn < 0) continue;

        const linkId = target.inputs[tgtPipeIn].link;
        const link = getLink(graph, linkId);
        if (!link) continue;

        const source = graph.getNodeById(link.origin_id);
        if (!isPipeNode(source) || source === target) continue;

        // both nodes must be of the same type
        if (!source.type===target.type) continue;
        if (!source.comfyClass===target.comfyClass) continue;

        // the incoming pipe link must come from the source's "pipe" output
        const srcPipeOut = findOutputSlot(source, PIPE_SLOT_NAME);
        if (srcPipeOut < 0 || link.origin_slot !== srcPipeOut) continue;

        // both nodes must be part of the current selection set
        if (!nodes.includes(source)) continue;

        // no other input of the target may be wired
        //if (!onlyOutputWithLinks(source, srcPipeOut)) continue;
        if (!onlyInputWithLink(target, tgtPipeIn)) continue;

        return { source, target, srcPipeOut };
    }
    return null;
}

// Origin nodes feeding any input of `node`.
function upstreamNeighbors(graph, node) {
    const result = [];
    if (!node.inputs) return result;
    for (const inp of node.inputs) {
        if (!inp || inp.link === null || inp.link === undefined) continue;
        const link = getLink(graph, inp.link);
        if (!link) continue;
        const origin = graph.getNodeById(link.origin_id);
        if (origin) result.push(origin);
    }
    return result;
}

// Shift nodes connected to `source` by (dx, dy):
//  - every node reachable downstream (via outputs), and
//  - the upstream neighbors of those moved nodes, unless they feed source
//    directly or sit to the left of source (X <= source.X).
function moveConnectedNodes(graph, source, dx, dy) {
    if (!dx && !dy) return;
    const visited = new Set([source.id]);
    const toMove = [];

    // downstream: every node reachable by following outputs
    const stack = [source];
    while (stack.length) {
        const node = stack.pop();
        if (!node.outputs) continue;
        for (const out of node.outputs) {
            if (!out || !out.links) continue;
            for (const lid of out.links) {
                const link = getLink(graph, lid);
                if (!link) continue;
                const next = graph.getNodeById(link.target_id);
                if (!next || visited.has(next.id)) continue;
                visited.add(next.id);
                toMove.push(next);
                stack.push(next);
            }
        }
    }

    // upstream neighbors of the moved nodes that should follow them
    const sourceInputIds = new Set(upstreamNeighbors(graph, source).map((n) => n.id));
    for (const node of [...toMove]) {
        for (const prev of upstreamNeighbors(graph, node)) {
            if (visited.has(prev.id)) continue;       // source or already moving
            if (sourceInputIds.has(prev.id)) continue; // feeds source directly
            if (prev.pos[0] <= source.pos[0]) continue; // on the left of source
            visited.add(prev.id);
            toMove.push(prev);
        }
    }

    for (const n of toMove) {
        n.pos[0] += dx;
        n.pos[1] += dy;
    }
}

// Merge `target` into `source`: move every outgoing link of target onto the
// matching (same-named) output of source, then remove target.
function mergePair(graph, source, target) {
    // capture the source->target offset before target is removed
    const dx = source.pos[0] - target.pos[0];
    const dy = source.pos[1] - target.pos[1];

    const moves = [];

    if (target.outputs) {
        for (let i = 0; i < target.outputs.length; i++) {
            const out = target.outputs[i];
            if (!out || !out.links || out.links.length === 0) continue;

            const srcSlot = findOutputSlot(source, out.name);
            if (srcSlot < 0) continue; // no matching output on the source, skip

            // copy the link ids: source.connect() mutates target.outputs[i].links
            for (const lid of [...out.links]) {
                const link = getLink(graph, lid);
                if (!link) continue;
                moves.push({
                    srcSlot,
                    targetNode: graph.getNodeById(link.target_id),
                    targetSlot: link.target_slot,
                });
            }
        }
    }

    for (const m of moves) {
        if (!m.targetNode) continue;
        source.connect(m.srcSlot, m.targetNode, m.targetSlot);
    }

    graph.remove(target);

    // now that target's downstream links hang off source, shift the connected nodes clear of source
    moveConnectedNodes(graph, source, dx, dy);
}

function joinPipes() {
    const graph = app.graph;
    const canvas = app.canvas;
    if (!graph || !canvas) return;

    let merged = 0;
    // guard against any unexpected cycle
    const MAX_ITERATIONS = 1000;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // rebuild the live selection each pass, dropping nodes already removed
        const selected = Object.values(canvas.selected_nodes || {}).filter(
            (n) => graph.getNodeById(n.id) === n
        );

        const pair = findPipePair(graph, selected);
        if (!pair) break;

        mergePair(graph, pair.source, pair.target);
        merged++;
    }

    if (merged > 0) {
        graph.setDirtyCanvas(true, true);
    }

    app.extensionManager?.toast?.add({
        severity: merged > 0 ? "success" : "info",
        summary: "Join Pipes",
        detail:
            merged > 0
                ? `Merged ${merged} pipe node${merged === 1 ? "" : "s"}.`
                : "No joinable pipe pair found in the selection.",
        life: 3000,
    });
}

// --- registration -------------------------------------------------------------

app.registerExtension({
    name: API_PREFIX + ".JoinPipes",

    getCanvasMenuItems() {
        return [
            {
                content: ADDON_PREFIX + " Join Pipe Nodes",
                callback: () => joinPipes(),
            },
        ];
    },
});
