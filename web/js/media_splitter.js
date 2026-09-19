// CREATED WITH CLAUDE
//
// Dynamic outputs of the Media Splitter node (py/media_loader.py, class
// MediaSplitter).
//
// The python node declares the outputs of the maximum number of rows of slots
// (untyped, generically named), and reads the row count from its `rows` widget
// to decide what each output carries : for R rows, in this order, 3R pictures
// (IMAGE), R videos (IMAGE), R video audios (AUDIO) and R audios (AUDIO). This
// module keeps the node showing exactly those outputs, named and typed, and
// adds the "Add slots" / "Remove slots" buttons that change `rows`. The `rows`
// widget itself is hidden, the buttons are its only interface.
//
// Outputs beyond the current rows are removed from the node ; adding rows
// appends the new outputs of each group after the existing ones, so the wires
// of the outputs that stay follow them to their new position.
//
// The node's right-click menu gets a "Clean media cache" entry, emptying the
// cache of decoded media the splitters share on the server.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";

const NODE_ID = ADDON_PREFIX + "MediaSplitter";
const ROWS_WIDGET = "rows";

// MAX_SPLIT_ROWS / DEFAULT_SPLIT_ROWS in python
const MAX_ROWS = 10;
const MIN_ROWS = 1;
const DEFAULT_ROWS = 3;

// the outputs of a splitter with `rows` rows, in order (split_layout in python)
function layoutFor(rows) {
    const out = [];
    for (let i = 0; i < 3 * rows; i++) out.push({ name: `picture_${i + 1}`, type: "IMAGE" });
    for (let i = 0; i < rows; i++) out.push({ name: `video_${i + 1}`, type: "IMAGE" });
    for (let i = 0; i < rows; i++) out.push({ name: `video_audio_${i + 1}`, type: "AUDIO" });
    for (let i = 0; i < rows; i++) out.push({ name: `audio_${i + 1}`, type: "AUDIO" });
    return out;
}

function rowsWidget(node) {
    return node.widgets?.find(w => w.name === ROWS_WIDGET);
}

function currentRows(node) {
    const w = rowsWidget(node);
    const rows = parseInt(w?.value, 10);
    return Number.isFinite(rows) ? Math.max(MIN_ROWS, Math.min(MAX_ROWS, rows)) : DEFAULT_ROWS;
}

// make the node's outputs match the layout of its rows : the existing outputs are kept (with
// their wires) when the layout still has them, the others are removed, the missing ones added,
// and the array is put in the layout's order with the wires' origin slots realigned
function syncOutputs(node) {
    const layout = layoutFor(currentRows(node));
    const byName = new Map((node.outputs ?? []).map(o => [o.name, o]));
    const ordered = [];
    for (const entry of layout) {
        let slot = byName.get(entry.name);
        if (slot) {
            byName.delete(entry.name);
            if (slot.type !== entry.type) {
                const idx = node.outputs.indexOf(slot);
                if (slot.links?.length && idx !== -1) node.disconnectOutput(idx);
                slot.type = entry.type;
            }
        } else {
            node.addOutput(entry.name, entry.type);
            slot = node.outputs[node.outputs.length - 1];
        }
        ordered.push(slot);
    }
    // whatever is left is not in the layout any more (removeOutput drops its wires)
    for (const slot of byName.values()) {
        const idx = node.outputs.indexOf(slot);
        if (idx !== -1) node.removeOutput(idx);
    }
    node.outputs.length = 0;
    node.outputs.push(...ordered);
    const links = node.graph?.links;
    if (links) {
        node.outputs.forEach((slot, i) => {
            for (const id of slot.links ?? []) {
                const link = links[id];
                if (link) link.origin_slot = i;
            }
        });
    }
    // snap the node height to its content
    requestAnimationFrame(() => {
        const size = node.computeSize();
        node.setSize([Math.max(node.size[0], size[0]), size[1]]);
        app.graph?.setDirtyCanvas(true, true);
    });
}

function outputsMatch(node) {
    const layout = layoutFor(currentRows(node));
    const outputs = node.outputs ?? [];
    return outputs.length === layout.length && layout.every((e, i) => outputs[i].name === e.name && outputs[i].type === e.type);
}

// the wires that a row removal would cut : the outputs of the last row that are connected
function wiredOutputsOfLastRow(node) {
    const rows = currentRows(node);
    const keep = new Set(layoutFor(rows - 1).map(e => e.name));
    return (node.outputs ?? []).filter(o => !keep.has(o.name) && o.links?.length).map(o => o.name);
}

async function confirmDialog(title, message) {
    const dialog = app.extensionManager?.dialog;
    if (typeof dialog?.confirm === "function") {
        return (await dialog.confirm({ title, message, type: "delete" })) === true;
    }
    return window.confirm(title + "\n\n" + message);
}

function setRows(node, rows) {
    const w = rowsWidget(node);
    if (!w) return;
    w.value = Math.max(MIN_ROWS, Math.min(MAX_ROWS, rows));
    syncOutputs(node);
    refreshButtons(node);
}

function refreshButtons(node) {
    const rows = currentRows(node);
    const add = node.widgets?.find(w => w.__nmsAdd), remove = node.widgets?.find(w => w.__nmsRemove);
    if (add) add.disabled = rows >= MAX_ROWS;
    if (remove) remove.disabled = rows <= MIN_ROWS;
}

// the buttons and the hidden rows widget, installed once per node
function setupNode(node) {
    if (node.__nmsSetup) return;
    const w = rowsWidget(node);
    if (!w) return;
    node.__nmsSetup = true;
    w.hidden = true;
    w.type = "hidden";
    w.computeSize = () => [0, -4];

    const add = node.addWidget("button", "Add slots", null, () => {
        if (currentRows(node) >= MAX_ROWS) return;
        setRows(node, currentRows(node) + 1);
    }, { serialize: false });
    add.__nmsAdd = true;
    const remove = node.addWidget("button", "Remove slots", null, async () => {
        const rows = currentRows(node);
        if (rows <= MIN_ROWS) return;
        const wired = wiredOutputsOfLastRow(node);
        if (wired.length) {
            const ok = await confirmDialog("Remove slots",
                `The last row has ${wired.length} connected output${wired.length > 1 ? "s" : ""} (${wired.join(", ")}). Remove the slots anyway ? Their wires will be dropped.`);
            if (!ok) return;
        }
        setRows(node, rows - 1);
    }, { serialize: false });
    remove.__nmsRemove = true;
    refreshButtons(node);
}

function toast(severity, summary, detail) {
    try {
        app.extensionManager?.toast?.add({ severity, summary, detail, life: 4000 });
    } catch {
        console.log(`[MediaSplitter] ${summary}: ${detail}`);
    }
}

// RMB entries of the splitter, grouped into the addon submenu
registerNodeMenu((node) => {
    if (node?.comfyClass !== NODE_ID) return [];
    return [{
        content: "Clean media cache",
        callback: async () => {
            try {
                const resp = await api.fetchApi(`/${API_PREFIX}/media_loader/clear_cache`, { method: "POST" });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw new Error(data.error || `request failed (${resp.status})`);
                toast("success", "Media cache cleared",
                    data.items ? `${data.items} item${data.items > 1 ? "s" : ""}, ${(data.bytes / 1024 ** 2).toFixed(0)} MB freed` : "the cache was already empty");
            } catch (err) {
                toast("error", "Media cache not cleared", err.message);
            }
        },
    }];
});

app.registerExtension({
    name: API_PREFIX + ".media_splitter",

    nodeCreated(node) {
        if (node.comfyClass !== NODE_ID) return;
        setupNode(node);
        // a fresh node shows the backend's generic outputs : trim them to the rows right away
        syncOutputs(node);
    },

    // called for every node each time a graph is (re)loaded : the outputs come from the
    // workflow, reconcile them with the rows widget in case they drifted
    loadedGraphNode(node) {
        if (node.comfyClass !== NODE_ID) return;
        setupNode(node);
        if (!outputsMatch(node)) syncOutputs(node);
        refreshButtons(node);
    },
});
