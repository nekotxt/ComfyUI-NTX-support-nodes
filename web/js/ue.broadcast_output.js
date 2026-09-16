// CREATED WITH CLAUDE
//
// "Change output to UE broadcast" — node RMB entry (registered through
// menu.js) that turns the wired outputs of the selected node(s) into
// "Anything Everywhere" broadcasts (cg-use-everywhere, UE 7.x).
//
// For every node in the selection (or just the right-clicked node when it is
// not part of the selection), and for each of its outputs, the user is asked
// for a global name. An empty or cancelled answer skips that output. Otherwise
// the name gets the "g_" prefix (unless it already has it); if a UE node on
// the canvas already carries that name (title or exact-match input regex) the
// user is warned and asked again. Then:
//   1. an Anything Everywhere node is added next to the source node and the
//      output is wired into it;
//   2. the AE node gets an input-name restriction `^name$` — so it only feeds
//      inputs called exactly `name`, of the output's data type — and is
//      titled `name`;
//   3. every link that left the output is followed: the input at its far end
//      is relabelled `name` and the link is removed. UE matches inputs by
//      `label || localized_name || name`, so the AE node now feeds it.
//
// Links whose far end is itself a UE node are left alone (relabelling and
// disconnecting an AE input would just orphan that node), as are links to a
// subgraph output slot, which has no node to relabel.

import { app } from "../../../scripts/app.js";
import { ADDON_NAME, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";

const MENU_LABEL = "Change output to UE broadcast";
const AE_TYPE = "Anything Everywhere";      // node id registered by cg-use-everywhere
const NAME_PREFIX = "g_";
const AE_MIN_SIZE = [200, 70];               // fits the title and the two slots an AE node ends up with
const AE_GAP_X = 60;                         // horizontal gap between the source node and its AE nodes
const AE_GAP_Y = 20;                         // vertical gap between stacked AE nodes

function toast(severity, summary, detail) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 5000 });
}

// Compat: graph.links/_links may be a Map or a plain object depending on the
// litegraph version. `== null` intentionally catches both null and undefined.
function getLink(graph, linkId) {
    if (!graph || linkId == null) return null;
    if (typeof graph.getLink === "function") return graph.getLink(linkId);
    const store = graph._links ?? graph.links;
    if (store instanceof Map) return store.get(linkId) ?? null;
    return store?.[linkId] ?? null;
}

// Same test cg-use-everywhere uses in is_UEnode().
function isUENode(node) {
    const type = node?.comfyClass;
    return typeof type === "string" &&
        (type.startsWith("Anything Everywhere") || type === "Seed Everywhere" || type === "Prompts Everywhere");
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Ask the user for the global name of `outputName` of `node`, shown as
// "#<id> (<title>) <output>". Resolves to null when the dialog is cancelled or
// closed; the caller treats "" the same way. `retry` carries the rejected name
// and the reason when re-asking after a clash.
async function askName(node, outputName, retry) {
    const subject = `#${node.id} (${node.title ?? node.type}) ${outputName}`;
    const message = retry
        ? `${retry.reason} Please choose another name for ${subject}.`
        : `What global name to use for ${subject}?`;
    const dialog = app.extensionManager?.dialog;
    if (typeof dialog?.prompt === "function") {
        return dialog.prompt({
            title: MENU_LABEL,
            message,
            defaultValue: retry?.name ?? "",
            placeholder: "leave empty to skip this output",
        });
    }
    return window.prompt(message, retry?.name ?? "");
}

// The node in `graph` that already claims `name` as a global name: a UE node
// titled `name`, or whose input regex targets exactly that name (the rule this
// routine writes). Case-sensitive, like UE's own regex matching.
function findNameOwner(graph, name) {
    const regex = `^${escapeRegex(name)}$`;
    return (graph._nodes ?? []).find((n) =>
        isUENode(n) && (n.title === name || n.properties?.ue_properties?.input_regex === regex)) ?? null;
}

// Prompt loop for one output: keeps asking while the entered name is already
// taken on the canvas. Resolves to the final (prefixed) name, or null to skip.
async function askFreeName(node, outputName) {
    const graph = node.graph;
    let retry = null;
    for (;;) {
        const answer = await askName(node, outputName, retry);
        let name = (answer ?? "").trim();
        if (!name) return null;
        if (!name.startsWith(NAME_PREFIX)) name = NAME_PREFIX + name;

        const owner = findNameOwner(graph, name);
        if (!owner) return name;
        const reason = `"${name}" is already used by node #${owner.id} (${owner.title}).`;
        toast("warn", MENU_LABEL, reason);
        retry = { name, reason };
    }
}

// Create the AE node for `output` of `node`, wire the output into it and set
// its restriction + title. Returns the node, or null when anything failed
// (the reason is reported through a toast).
function createBroadcastNode(node, slotIndex, name, stackIndex) {
    const graph = node.graph;
    const ae = LiteGraph.createNode(AE_TYPE);
    if (!ae) {
        toast("error", MENU_LABEL, `Could not create a "${AE_TYPE}" node.`);
        return null;
    }

    ae.title = name;
    ae.properties ??= {};
    // ue_properties is normally filled by UE's own nodeCreated hook; make sure
    // the keys we rely on exist even if that hook did not run.
    ae.properties.ue_properties = {
        ...(ae.properties.ue_properties ?? {}),
        input_regex: `^${escapeRegex(name)}$`,
        input_regex_invert: false,
    };

    // stack the AE nodes to the right of the source node, one per output.
    // computeSize() only knows the current single slot and under-estimates the
    // title bar, so keep at least AE_MIN_SIZE: room for the name and for the
    // spare "anything" slot UE appends right after the connection.
    const size = ae.computeSize();
    ae.setSize([Math.max(size[0], AE_MIN_SIZE[0]), Math.max(size[1], AE_MIN_SIZE[1])]);
    ae.pos = [
        node.pos[0] + node.size[0] + AE_GAP_X,
        node.pos[1] + stackIndex * (ae.size[1] + LiteGraph.NODE_TITLE_HEIGHT + AE_GAP_Y),
    ];
    graph.add(ae);

    // input 0 of a fresh AE node is its single "anything" (*) slot; UE types
    // and labels it from the link, then adds the spare slot itself
    const link = node.connect(slotIndex, ae, 0);
    if (!link) {
        graph.remove(ae);
        toast("error", MENU_LABEL, `Could not connect output "${node.outputs[slotIndex]?.name}" to the ${AE_TYPE} node.`);
        return null;
    }
    return ae;
}

// Relabel the far end of every link in `linkIds` and remove the link. Returns
// the number of inputs relabelled.
function redirectConsumers(graph, linkIds, name) {
    let count = 0;
    for (const linkId of linkIds) {
        const link = getLink(graph, linkId);
        if (!link) continue;
        const target = graph.getNodeById?.(link.target_id);
        if (!target) {
            console.warn(`[${ADDON_NAME}] ${MENU_LABEL}: link ${linkId} has no target node (subgraph output?) — left in place`);
            continue;
        }
        if (isUENode(target)) {
            console.warn(`[${ADDON_NAME}] ${MENU_LABEL}: link ${linkId} feeds UE node "${target.title}" — left in place`);
            continue;
        }
        const input = target.inputs?.[link.target_slot];
        if (!input) continue;
        input.label = name;
        target.disconnectInput(link.target_slot);
        count++;
    }
    return count;
}

// Run the routine on one node. Returns a tally for the final report.
async function broadcastOutputs(node) {
    const tally = { outputs: 0, inputs: 0 };
    const graph = node.graph;
    if (!graph) return tally;

    // snapshot: the outputs/links the node has now, before AE nodes get wired in
    const outputs = (node.outputs ?? []).map((out, index) => ({
        index,
        name: out.label || out.localized_name || out.name || `output ${index}`,
        links: [...(out.links ?? [])],
    }));

    for (const out of outputs) {
        if (!graph.getNodeById?.(node.id)) break;    // node removed meanwhile

        const name = await askFreeName(node, out.name);
        if (!name) continue;

        graph.beforeChange?.();
        try {
            const ae = createBroadcastNode(node, out.index, name, tally.outputs);
            if (!ae) continue;
            tally.outputs++;
            tally.inputs += redirectConsumers(graph, out.links, name);
        } finally {
            graph.afterChange?.();
        }
        graph.setDirtyCanvas?.(true, true);
    }
    return tally;
}

async function run(clicked) {
    if (!LiteGraph.registered_node_types?.[AE_TYPE]) {
        toast("error", MENU_LABEL, `The "${AE_TYPE}" node is not available — is cg-use-everywhere installed?`);
        return;
    }

    // the whole selection when the right-clicked node is part of it,
    // otherwise just the right-clicked node
    const selected = Object.values(app.canvas?.selected_nodes ?? {}).filter((n) => n?.graph);
    const nodes = selected.includes(clicked) ? selected : [clicked];

    const total = { outputs: 0, inputs: 0 };
    for (const node of nodes) {
        const tally = await broadcastOutputs(node);
        total.outputs += tally.outputs;
        total.inputs += tally.inputs;
    }

    const n = nodes.length;
    toast(
        total.outputs ? "success" : "info",
        MENU_LABEL,
        `${n} node${n === 1 ? "" : "s"}: ${total.outputs} output${total.outputs === 1 ? "" : "s"} broadcast, ` +
        `${total.inputs} input${total.inputs === 1 ? "" : "s"} relabelled.`,
    );
}

registerNodeMenu((node) => {
    if (!node?.outputs?.length || isUENode(node)) return [];
    return [{
        content: MENU_LABEL,
        callback: () => {
            run(node).catch((err) => {
                console.error(`[${ADDON_NAME}] ${MENU_LABEL} failed`, err);
                toast("error", MENU_LABEL, String(err?.message ?? err));
            });
        },
    }];
});

app.registerExtension({
    name: API_PREFIX + ".ue.broadcast_output",
});
