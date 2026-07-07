// CREATED WITH CLAUDE

// RMB option on the non-output preview nodes to queue them as if they were
// output nodes. The backend only accepts OUTPUT_NODE classes as partial
// execution targets, so at queue time the node's class_type is swapped (in the
// API prompt only, never in the saved workflow) to the equivalent core output
// node. Both core twins take the same-named input, and the executed UI message
// still routes to this node id, so the preview shows up on the node as usual.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";

// our node id -> core OUTPUT_NODE class with an identical input signature
const OUTPUT_TWIN = {
    [ADDON_PREFIX + "PreviewImage"]: "PreviewImage",   // input: images
    [ADDON_PREFIX + "PreviewAsText"]: "PreviewAny",    // input: source
};

function toast(severity, summary, detail) {
    try {
        app.extensionManager?.toast?.add({ severity, summary, detail, life: 4000 });
    } catch (err) {
        console.log(`${summary}: ${detail}`);
    }
}

async function queueAsOutput(node) {
    const twin = OUTPUT_TWIN[node.comfyClass];
    if (!twin) return;

    const p = await app.graphToPrompt();
    const id = String(node.id);
    const entry = p.output?.[id];
    if (!entry) {
        // muted/bypassed nodes are dropped from the prompt; subgraph nodes get
        // composite execution ids we do not resolve here
        toast("warn", "Preview queue", "This node is not part of the serialized prompt (muted, bypassed or inside a subgraph).");
        return;
    }

    entry.class_type = twin;

    try {
        await api.queuePrompt(0, { output: p.output, workflow: p.workflow },
            { partialExecutionTargets: [id] });
    } catch (err) {
        console.error("Preview queue failed", err);
        toast("error", "Preview queue failed", err?.message ?? String(err));
    }
}

app.registerExtension({
    name: API_PREFIX + ".various.preview_queue",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!(nodeData.name in OUTPUT_TWIN)) return;

        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            const r = getExtraMenuOptions?.apply(this, arguments);
            options.push({
                content: ADDON_PREFIX + " Queue (this node as output)",
                callback: () => { queueAsOutput(this); },
            });
            return r;
        };
    },
});
