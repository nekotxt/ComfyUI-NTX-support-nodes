// CREATED WITH CLAUDE FABLE 5

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerCanvasMenu } from "./menu.js";

// ── Configuration ─────────────────────────────────────────────────────────────
// The subdirectory (inside the ComfyUI user "workflows" folder) scanned for
// template workflows is configured with the "templates_subdir" entry of
// input/ntx_data/config.yaml and served by py/load_template_workflow.py — see
// fetchTemplatesSubdir. Leaving that entry unset scans the whole "workflows"
// folder.

// Name of the throw-away workflow tab used while importing a template. The
// frontend appends ".json" and de-conflicts the path, so collisions with real
// workflows are not an issue.
const TEMP_TAB_NAME = "__wftemplate_temp__";

// When true, the template list is fetched from the server only once and reused
// for the rest of the session (new/renamed/deleted files won't show up until
// the page is reloaded). When false, the list is fetched on every menu open.
const CACHE_LIST = true;

// Horizontal spacing between templates when several are inserted at once.
const STACK_GAP = 60;

// ── Auto-connect ──────────────────────────────────────────────────────────────
// Node class and slot signature used to chain consecutive templates together
// (see autoConnectTemplate).
const PIPE_NODE_ID = ADDON_PREFIX + "PipeCustom";
const PIPE_SLOT_NAME = "pipe";
const PIPE_SLOT_TYPE = "DICT";

// How far apart (graph units) two nodes' edges may be and still count as the
// same column when looking for the pipe endpoints. Absorbs hand-placement slop;
// keep it well below the width of a node so neighbouring columns stay separate.
const COLUMN_TOLERANCE = 20;

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.lwt-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 99998;
    display: flex;
    align-items: center;
    justify-content: center;
}

.lwt-panel {
    display: flex;
    flex-direction: column;
    width: 460px;
    max-width: 90vw;
    max-height: 75vh;
    background: #1e1e1e;
    border: 1px solid #555;
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.7);
    font-family: sans-serif;
    font-size: 12px;
    color: #ccc;
    overflow: hidden;
}

.lwt-title {
    padding: 9px 12px;
    font-size: 13px;
    color: #eee;
    background: #252525;
    border-bottom: 1px solid #444;
    user-select: none;
}

.lwt-title small {
    display: block;
    margin-top: 2px;
    font-size: 10px;
    color: #777;
}

.lwt-filter {
    margin: 8px 10px 4px;
    padding: 5px 7px;
    background: #252525;
    border: 1px solid #444;
    border-radius: 3px;
    color: #ccc;
    font-size: 11px;
    outline: none;
}

.lwt-filter:focus {
    border-color: #4a90d9;
}

.lwt-tree {
    flex: 1 1 auto;
    overflow-y: auto;
    margin: 4px 4px 6px;
    padding: 0 6px;
    min-height: 120px;
}

.lwt-empty {
    padding: 24px 10px;
    text-align: center;
    color: #777;
}

.lwt-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
}

.lwt-row:hover {
    background: rgba(255, 255, 255, 0.06);
}

.lwt-row.selected {
    background: rgba(74, 144, 217, 0.25);
    color: #fff;
}

.lwt-row .lwt-ico {
    flex: 0 0 auto;
    font-size: 10px;
    color: #888;
}

.lwt-row.folder .lwt-ico {
    color: #c9a44a;
}

.lwt-row .lwt-ord {
    flex: 0 0 auto;
    margin-left: auto;
    min-width: 14px;
    padding: 0 4px;
    border-radius: 7px;
    background: #4a90d9;
    color: #fff;
    font-size: 9px;
    line-height: 14px;
    text-align: center;
}

.lwt-row .lwt-ord:empty {
    display: none;
}

.lwt-children {
    margin-left: 14px;
    border-left: 1px solid #333;
    padding-left: 4px;
}

.lwt-children.collapsed {
    display: none;
}

.lwt-preset {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    background: #252525;
    border-top: 1px solid #444;
    user-select: none;
}

.lwt-preset select {
    flex: 1 1 auto;
    min-width: 0;
    padding: 4px 6px;
    background: #1e1e1e;
    border: 1px solid #444;
    border-radius: 3px;
    color: #ccc;
    font-family: inherit;
    font-size: 11px;
    outline: none;
    cursor: pointer;
}

.lwt-preset select:focus {
    border-color: #4a90d9;
}

.lwt-preset select:disabled {
    opacity: 0.5;
    cursor: default;
}

.lwt-opts {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    background: #252525;
    border-top: 1px solid #444;
    user-select: none;
}

.lwt-opts label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}

.lwt-opts label + label {
    margin-left: 14px;
}

.lwt-opts input {
    margin: 0;
    accent-color: #4a90d9;
    cursor: pointer;
}

.lwt-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 10px;
    background: #252525;
    border-top: 1px solid #444;
}

.lwt-btn {
    padding: 5px 16px;
    background: #2a2a2a;
    color: #bbb;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
}

.lwt-btn:hover {
    background: #3a3a3a;
    color: #eee;
}

.lwt-btn.primary {
    background: #2c5687;
    border-color: #4a90d9;
    color: #fff;
}

.lwt-btn.primary:hover {
    background: #3a6ca7;
}

.lwt-btn:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
}

.lwt-btn.refresh {
    margin-right: auto;   /* push the confirm/cancel buttons to the right */
}

.lwt-btn.refresh.busy {
    opacity: 0.6;
    pointer-events: none;
}

/* "Save as preset" name prompt, stacked on top of the picker */

.lwt-overlay.sub {
    z-index: 99999;
}

.lwt-panel.small {
    width: 340px;
}

.lwt-msg {
    padding: 2px 12px 8px;
    min-height: 13px;
    font-size: 11px;
    color: #d0913a;
}
`;

let _stylesInjected = false;
function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const s = document.createElement("style");
    s.textContent = CSS;
    document.head.appendChild(s);
}

// ── Workflow listing ──────────────────────────────────────────────────────────

function toast(severity, summary, detail) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 4000 });
}

// The configured templates subdirectory, fetched once per session (the backend
// reads config.yaml at import time, so it cannot change without a restart) and
// then reused. Never rejects: an unreachable endpoint is treated like an unset
// entry rather than leaving the picker unusable.
let _templatesSubdir = null;

async function fetchTemplatesSubdir() {
    if (_templatesSubdir !== null) return _templatesSubdir;

    let subdir = "";
    try {
        const resp = await api.fetchApi(`/${API_PREFIX}/load_template_workflow_subdir`);
        if (!resp.ok) throw new Error(`subdir HTTP ${resp.status}`);
        subdir = String((await resp.json())?.subdir ?? "");
    } catch (err) {
        console.error("[LoadWfTemplate] failed to read the configured templates subdir:", err);
    }
    _templatesSubdir = subdir;
    return _templatesSubdir;
}

// The scanned folder as a userdata path. Synchronous, for the dialog's labels
// and messages — all of them run after fetchTemplateList has resolved the
// subdir.
function templatesDir() {
    return _templatesSubdir ? `workflows/${_templatesSubdir}` : "workflows";
}

let _templateListCache = null;

async function fetchTemplateList(force = false) {
    if (CACHE_LIST && _templateListCache && !force) return _templateListCache;

    await fetchTemplatesSubdir();
    const dir = templatesDir();
    const resp = await api.fetchApi(
        `/userdata?dir=${encodeURIComponent(dir)}&recurse=true&split=false&full_info=false`
    );
    if (resp.status === 404) return [];           // directory doesn't exist yet
    if (!resp.ok) throw new Error(`userdata listing HTTP ${resp.status}`);
    const files = await resp.json();
    const paths = files
        .map(f => String(f).replaceAll("\\", "/"))
        .filter(f => f.toLowerCase().endsWith(".json"))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (CACHE_LIST) _templateListCache = paths;
    return paths;
}

// ── Presets ───────────────────────────────────────────────────────────────────
// Named sets of templates, maintained by the user in
// input/ntx_data/workflow_template_presets.yaml and served by
// py/load_template_workflow.py as [{ name, templates: [relPath, …] }, …].
// Picking one replaces the tree selection with the preset's templates.

let _presetListCache = null;

async function fetchPresetList(force = false) {
    if (CACHE_LIST && _presetListCache && !force) return _presetListCache;

    const resp = await api.fetchApi(`/${API_PREFIX}/load_template_workflow_presets`);
    if (!resp.ok) throw new Error(`presets HTTP ${resp.status}`);
    const presets = (await resp.json()).filter(p => p?.name && p.templates?.length);
    if (CACHE_LIST) _presetListCache = presets;
    return presets;
}

// A preset entry as it would appear in the scanned template list: separators
// normalised, no leading "./", ".json" optional (the yaml is meant to be typed
// by hand).
function normalizeTemplateRef(ref) {
    const path = String(ref).trim().replaceAll("\\", "/").replace(/^\.?\//, "");
    return /\.json$/i.test(path) ? path : `${path}.json`;
}

// ── Workflow loading ──────────────────────────────────────────────────────────
// Strategy: open the template in a temporary workflow tab so the frontend's own
// loading pipeline builds every node and registers every subgraph definition,
// copy everything from that tab, switch back to the original tab, delete the
// temporary tab, and paste. The paste remaps node/link/subgraph ids (so nothing
// collides with existing content) and leaves the pasted items selected.

// Bounding-box width of a serialized clipboard payload, used to place several
// templates side by side. Serialized pos/size survive the JSON round-trip
// either as arrays or as {"0": x, "1": y} objects; numeric index access covers
// both.
function itemsWidth(items) {
    let minX = Infinity;
    let maxX = -Infinity;
    const grow = (left, right) => {
        if (left < minX) minX = left;
        if (right > maxX) maxX = right;
    };
    for (const n of items.nodes ?? []) {
        if (n.pos) grow(+n.pos[0], +n.pos[0] + (+(n.size?.[0]) || 0));
    }
    for (const r of items.reroutes ?? []) {
        if (r.pos) grow(+r.pos[0], +r.pos[0]);
    }
    for (const g of items.groups ?? []) {
        if (g.bounding) grow(+g.bounding[0], +g.bounding[0] + (+g.bounding[2] || 0));
    }
    return maxX > minX ? maxX - minX : 0;
}

// ── Auto-connect ──────────────────────────────────────────────────────────────
// Optional chaining of consecutively inserted templates: a pipe output in the
// rightmost column of the previous template is wired to a pipe input in the
// leftmost column of the template that was just pasted.

// The name shown next to a slot on the canvas, following the same precedence
// litegraph renders with (NodeSlot.renderingLabel). Slots are matched on this
// rather than on `name`: a subgraph promotes its interior slot names ("dict",
// "value", …) and carries the user-facing name in `label`, and conversely a
// PipeCustom pipe relabelled "text_params" is carrying something other than the
// pipe, so it is deliberately not a match.
function slotLabel(slot) {
    return String(slot.label || slot.localized_name || slot.name || "").toLowerCase();
}

// Index of the "pipe" slot to wire on `node`, or -1 when the node is not a valid
// pipe endpoint. PipeCustom nodes qualify through their fixed slot 0; a subgraph
// node qualifies when the slot is a DICT.
function pipeSlotIndex(node, kind) {
    if (!node) return -1;
    const slots = (kind === "input" ? node.inputs : node.outputs) ?? [];
    const idx = slots.findIndex(s => s && slotLabel(s) === PIPE_SLOT_NAME);
    if (idx === -1) return -1;
    if (String(slots[idx].type).toUpperCase() === PIPE_SLOT_TYPE) return idx;
    return -1;
}

// The nodes of the outermost column — leftmost for an input, rightmost for an
// output — ordered top to bottom. Each side is grouped by the edge its slots
// live on: inputs by the nodes' left edge, outputs by their right edge (so a
// narrow node tucked under a wide one still shares the column when they end
// flush, which is how the templates are laid out).
function extremeColumn(nodes, kind) {
    const edge = kind === "input"
        ? n => +n.pos[0]
        : n => +n.pos[0] + (+(n.size?.[0]) || 0);
    const candidates = nodes.filter(n => n?.pos?.[0] != null);
    if (!candidates.length) return [];
    const edges = candidates.map(edge);
    const columnEdge = kind === "input" ? Math.min(...edges) : Math.max(...edges);
    return candidates
        .filter(n => Math.abs(edge(n) - columnEdge) <= COLUMN_TOLERANCE)
        .sort((a, b) => (+a.pos[1]) - (+b.pos[1]));
}

// First node of that column exposing a pipe slot of the requested kind, as
// [node, slotIndex]; [null, -1] when none does. The search never leaves the
// column: the templates are meant to be chained edge to edge, so a pipe further
// in is not a connection point.
function findPipeEndpoint(nodes, kind) {
    for (const node of extremeColumn(nodes, kind)) {
        const slot = pipeSlotIndex(node, kind);
        if (slot !== -1) return [node, slot];
    }
    return [null, -1];
}

// `pastedNodes` are the nodes of the template that was just inserted,
// `previousIds` the node ids of the template inserted before it. Ids rather than
// node objects: loading a template reloads the target tab (see loadTemplate), so
// the node objects of earlier templates are replaced by equivalent ones carrying
// the same ids. Both ends must expose a pipe slot, otherwise nothing happens.
// Returns true when a link was created.
function autoConnectTemplate(pastedNodes, previousIds) {
    const [target, inSlot] = findPipeEndpoint(pastedNodes, "input");
    if (!target) return false;

    const graph = app.canvas.graph;
    const previous = previousIds.map(id => graph?.getNodeById(id)).filter(Boolean);
    const [source, outSlot] = findPipeEndpoint(previous, "output");
    if (!source) return false;

    if (!source.connect(outSlot, target, inSlot)) return false;
    app.canvas.setDirty(true, true);
    return true;
}

// Returns the width of the inserted items (so multiple templates can be placed
// one to the right of the other) along with the created nodes, in graph order.
async function loadTemplate(relPath, dropPos) {
    await fetchTemplatesSubdir();
    const fullPath = `${templatesDir()}/${relPath}`;
    const resp = await api.fetchApi(`/userdata/${encodeURIComponent(fullPath)}`);
    if (!resp.ok) throw new Error(`userdata read HTTP ${resp.status}`);
    const graphData = await resp.json();

    const workflowStore = app.extensionManager?.workflow;
    if (!workflowStore?.activeWorkflow) throw new Error("no active workflow tab");
    const originalWorkflow = workflowStore.activeWorkflow;

    const loadOptions = { checkForRerouteMigration: false, deferWarnings: true };
    let tempWorkflow = null;
    let copiedItems = null;

    try {
        // 1. Passing a string as the `workflow` argument makes loadGraphData
        //    create and activate a brand-new temporary tab for the template.
        await app.loadGraphData(graphData, true, true, TEMP_TAB_NAME, loadOptions);
        tempWorkflow = workflowStore.activeWorkflow;
        if (tempWorkflow === originalWorkflow) tempWorkflow = null;

        // 2. Select everything in the temporary tab and serialise it. This is
        //    what copyToClipboard does, minus the localStorage write — big
        //    workflows can exceed the localStorage quota, so the copy is kept
        //    in memory instead (also leaves the real clipboard untouched).
        //    The serialisation embeds any (nested) subgraph definitions in use.
        app.canvas.selectItems();
        copiedItems = JSON.parse(JSON.stringify(app.canvas._serializeItems()));
    } finally {
        // 3. Switch back to the original tab — the same loadGraphData call the
        //    frontend's workflowService.openWorkflow makes for an already
        //    loaded workflow (activeState was snapshotted on tab switch).
        if (workflowStore.activeWorkflow !== originalWorkflow) {
            await app.loadGraphData(originalWorkflow.activeState, true, true, originalWorkflow, {
                ...loadOptions,
                skipAssetScans: true,
            });
        }

        // 4. Delete the temporary tab. The store-level close removes a
        //    temporary workflow outright, without any save-confirmation UI.
        if (tempWorkflow) await workflowStore.closeWorkflow(tempWorkflow);
    }

    // 5. Paste into the original tab (pasteFromClipboard minus the
    //    localStorage read); pasted items stay selected so the user can
    //    immediately drag them into place. `position` places the top-left
    //    corner of the pasted items' bounding box at the recorded mouse
    //    position (where the context menu was opened); without it the paste
    //    lands at the canvas' current graph_mouse.
    if (copiedItems) {
        const pasted = app.canvas._deserializeItems(
            copiedItems, dropPos ? { position: dropPos } : {});
        // `pasted.nodes` maps the serialised ids to the live nodes just added to
        // the graph, with their final (offset) positions already applied.
        return { width: itemsWidth(copiedItems), nodes: [...(pasted?.nodes?.values() ?? [])] };
    }
    return { width: 0, nodes: [] };
}

// ── Tree model ────────────────────────────────────────────────────────────────
// Paths are relative to the templates subdir, e.g. "sdxl/portraits/base.json".

function buildTree(paths) {
    const root = { dirs: new Map(), files: [] };
    for (const p of paths) {
        const parts = p.split("/");
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!node.dirs.has(parts[i])) {
                node.dirs.set(parts[i], { dirs: new Map(), files: [] });
            }
            node = node.dirs.get(parts[i]);
        }
        node.files.push({ name: parts[parts.length - 1], path: p });
    }
    return root;
}

// ── Dialog ────────────────────────────────────────────────────────────────────

// Path of the template loaded most recently; when the dialog is reopened it is
// pre-selected again, with its parent folders expanded and scrolled into view.
let _lastLoadedPath = null;

// State of the "automatically connect added templates" checkbox — on by
// default, then remembered for the rest of the session.
let _autoConnect = true;

function openTemplateDialog(paths, presets, dropPos, initialFilter = "", initialSelected = null,
                           initialAutoConnect = _autoConnect, initialPreset = "") {
    injectStyles();
    document.querySelector(".lwt-overlay")?.remove();

    const tree = buildTree(paths);
    const expanded = new Set();        // folder paths currently expanded
    // Selected template paths, in click order — templates are inserted in this
    // order. Plain click selects one; Ctrl/Cmd+click adds/removes.
    let selected = (initialSelected ?? [_lastLoadedPath]).filter(p => paths.includes(p));
    let lastClick = { path: null, time: 0 };   // manual double-click detection

    // Expand every folder on the way to `path`, so a selection made outside the
    // tree (remembered entry, preset) is visible without hunting for it.
    function expandTo(path) {
        const parts = path.split("/");
        let dirPath = "";
        for (let i = 0; i < parts.length - 1; i++) {
            dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i];
            expanded.add(dirPath);
        }
    }

    for (const sel of selected) expandTo(sel);

    const overlay = document.createElement("div");
    overlay.className = "lwt-overlay";

    const panel = document.createElement("div");
    panel.className = "lwt-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "lwt-title";
    title.innerHTML = `Load template workflow<small></small>`;
    title.querySelector("small").textContent =
        `${templatesDir()} · Ctrl+click to select multiple`;
    panel.appendChild(title);

    const filterInput = document.createElement("input");
    filterInput.className = "lwt-filter";
    filterInput.type = "text";
    filterInput.placeholder = "Filter…";
    filterInput.setAttribute("autocomplete", "off");
    filterInput.value = initialFilter;
    panel.appendChild(filterInput);

    const treeEl = document.createElement("div");
    treeEl.className = "lwt-tree";
    panel.appendChild(treeEl);

    // Preset picker: selecting an entry replaces the whole tree selection with
    // the templates the preset lists (see applyPreset).
    const presetRow = document.createElement("div");
    presetRow.className = "lwt-preset";
    const presetLabel = document.createElement("span");
    presetLabel.textContent = "Preset";
    const presetSelect = document.createElement("select");
    presetSelect.title = presets.length
        ? "Replace the selection with the templates of a predefined set"
        : "No presets defined in workflow_template_presets.yaml";
    presetSelect.disabled = !presets.length;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = presets.length ? "— none —" : "— no presets —";
    presetSelect.appendChild(placeholder);
    for (const preset of presets) {
        const opt = document.createElement("option");
        opt.value = preset.name;
        opt.textContent = preset.name;
        opt.title = preset.templates.join("\n");
        presetSelect.appendChild(opt);
    }
    // Only keep the carried-over pick when that preset still exists.
    presetSelect.value = presets.some(p => p.name === initialPreset) ? initialPreset : "";
    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    panel.appendChild(presetRow);

    // Wrapping the checkbox in its <label> makes the text clickable without
    // needing a document-wide id.
    const opts = document.createElement("div");
    opts.className = "lwt-opts";
    const autoConnectInput = document.createElement("input");
    autoConnectInput.type = "checkbox";
    autoConnectInput.checked = !!initialAutoConnect;
    const autoConnectLabel = document.createElement("label");
    autoConnectLabel.textContent = "Automatically connect added templates";
    autoConnectLabel.title =
        "From the second template on, wire a pipe output of the previous template to a " +
        "pipe input of this one: the rightmost column of the previous template and the " +
        "leftmost column of this one are each scanned top to bottom for the first node " +
        `that has a ${PIPE_SLOT_TYPE} "${PIPE_SLOT_NAME}" slot`;
    autoConnectLabel.prepend(autoConnectInput);
    opts.appendChild(autoConnectLabel);

    // Deliberately not remembered between openings (unlike auto-connect): saving
    // a preset is a one-off action, not a mode.
    const savePresetInput = document.createElement("input");
    savePresetInput.type = "checkbox";
    const savePresetLabel = document.createElement("label");
    savePresetLabel.textContent = "Save as preset";
    savePresetLabel.title =
        "On Load, ask for a name and store the selected templates, in selection order, " +
        "as a preset in workflow_template_presets.yaml";
    savePresetLabel.prepend(savePresetInput);
    opts.appendChild(savePresetLabel);
    panel.appendChild(opts);

    const btns = document.createElement("div");
    btns.className = "lwt-btns";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "lwt-btn refresh";
    refreshBtn.textContent = "↻ Refresh";
    refreshBtn.title = "Rescan the templates folder (rebuild the cached list)";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "lwt-btn";
    cancelBtn.textContent = "Cancel";

    const loadBtn = document.createElement("button");
    loadBtn.className = "lwt-btn primary";
    loadBtn.textContent = "Load";
    loadBtn.disabled = !selected.length;

    btns.appendChild(refreshBtn);
    btns.appendChild(cancelBtn);
    btns.appendChild(loadBtn);
    panel.appendChild(btns);

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    }

    // Ask for a name and store `batch` under it as a preset. Resolves to true
    // once the preset is saved and false when the user backs out — the caller
    // then loads nothing, so cancelling here cancels the whole action. Like the
    // custom-pipe template dialog, an existing name is not overwritten silently:
    // the Save button turns into an explicit Overwrite step.
    function askSavePreset(batch) {
        return new Promise(resolve => {
            const subOverlay = document.createElement("div");
            subOverlay.className = "lwt-overlay sub";

            const subPanel = document.createElement("div");
            subPanel.className = "lwt-panel small";
            subOverlay.appendChild(subPanel);

            const subTitle = document.createElement("div");
            subTitle.className = "lwt-title";
            subTitle.innerHTML = `Save as preset<small></small>`;
            subTitle.querySelector("small").textContent =
                `${batch.length} template${batch.length === 1 ? "" : "s"}, in selection order`;
            subPanel.appendChild(subTitle);

            const nameInput = document.createElement("input");
            nameInput.className = "lwt-filter";
            nameInput.type = "text";
            nameInput.placeholder = "Preset name…";
            nameInput.setAttribute("autocomplete", "off");
            // Editing an existing preset without renaming it is the common case.
            nameInput.value = presetSelect.value;
            subPanel.appendChild(nameInput);

            const msg = document.createElement("div");
            msg.className = "lwt-msg";
            subPanel.appendChild(msg);

            const subBtns = document.createElement("div");
            subBtns.className = "lwt-btns";
            const subCancel = document.createElement("button");
            subCancel.className = "lwt-btn";
            subCancel.textContent = "Cancel";
            const subSave = document.createElement("button");
            subSave.className = "lwt-btn primary";
            subSave.textContent = "Save";
            subBtns.appendChild(subCancel);
            subBtns.appendChild(subSave);
            subPanel.appendChild(subBtns);

            let overwrite = false;

            // While this overlay is up the picker's own key handler is suspended,
            // so Esc/Enter act on the name prompt only.
            function finish(saved) {
                document.removeEventListener("keydown", onSubKey, true);
                subOverlay.remove();
                document.addEventListener("keydown", onKey, true);
                resolve(saved);
            }

            const onSubKey = e => {
                if (e.key === "Escape") { e.stopPropagation(); finish(false); }
                if (e.key === "Enter") { e.stopPropagation(); doSave(); }
            };

            async function doSave() {
                const name = nameInput.value.trim();
                if (!name) { msg.textContent = "The preset name cannot be empty."; return; }
                subSave.disabled = true;
                let result;
                try {
                    const resp = await api.fetchApi(`/${API_PREFIX}/save_template_workflow_preset`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, overwrite, templates: batch }),
                    });
                    result = await resp.json();
                } catch (err) {
                    console.error("[LoadWfTemplate] failed to save preset:", err);
                    result = null;
                }
                subSave.disabled = false;

                if (result?.ok) {
                    _presetListCache = null;   // the picker rebuilds its list on the next open
                    toast("success", "Preset saved",
                        `"${result.name}" now holds ${batch.length} template(s)`);
                    finish(true);
                } else if (result?.status === "exists") {
                    overwrite = true;
                    subSave.textContent = "Overwrite";
                    msg.textContent = `"${result.name}" already exists — press Overwrite to replace it.`;
                } else {
                    msg.textContent = `Could not save: ${result?.status ?? "unknown error"}`;
                }
            }

            // a different name needs its own overwrite confirmation
            nameInput.addEventListener("input", () => {
                overwrite = false;
                subSave.textContent = "Save";
                msg.textContent = "";
            });

            subCancel.addEventListener("click", () => finish(false));
            subSave.addEventListener("click", doSave);
            subOverlay.addEventListener("pointerdown", e => {
                if (e.target === subOverlay) finish(false);
            });

            document.removeEventListener("keydown", onKey, true);
            document.addEventListener("keydown", onSubKey, true);
            document.body.appendChild(subOverlay);
            nameInput.focus();
            nameInput.select();
        });
    }

    // Load every selected template, in selection order, each one placed to the
    // right of the previous one's bounding box. With auto-connect on, every
    // template after the first is also wired to the one inserted before it.
    // With "Save as preset" ticked the selection is stored first; cancelling that
    // prompt aborts the whole thing and leaves the picker open, untouched.
    let confirming = false;
    async function confirmLoad() {
        if (!selected.length || confirming) return;
        const batch = [...selected];
        if (savePresetInput.checked) {
            confirming = true;             // re-entry guard while the prompt is up
            const saved = await askSavePreset(batch);
            confirming = false;
            if (!saved) return;
        }
        selected = [];                 // re-entry guard: confirm only once
        const autoConnect = autoConnectInput.checked;
        _autoConnect = autoConnect;    // remember for the next dialog open
        close();
        const pos = dropPos ? [...dropPos] : null;
        const failed = [];
        let previousIds = null;         // node ids of the template inserted last
        for (const path of batch) {
            try {
                const { width, nodes } = await loadTemplate(path, pos);
                _lastLoadedPath = path;    // remember for the next dialog open
                if (pos) pos[0] += width + STACK_GAP;
                // Starting from the second template, hook it up to the previous one.
                if (autoConnect && previousIds) autoConnectTemplate(nodes, previousIds);
                previousIds = nodes.map(n => n.id);
            } catch (err) {
                console.error(`[LoadWfTemplate] failed to load workflow "${path}":`, err);
                failed.push(path);
            }
        }
        if (failed.length) {
            toast("error", "Load failed", `Could not load: ${failed.join(", ")}`);
        }
    }

    // Replace the current selection with the templates of `preset`, in the order
    // the yaml lists them. Entries that no longer exist in the scanned folder are
    // skipped and reported; a template listed twice is selected once (the tree
    // selection is a set of paths).
    function applyPreset(preset) {
        const byLowerPath = new Map(paths.map(p => [p.toLowerCase(), p]));
        const found = [];
        const missing = [];
        for (const ref of preset.templates) {
            const path = byLowerPath.get(normalizeTemplateRef(ref).toLowerCase());
            if (!path) missing.push(ref);
            else if (!found.includes(path)) found.push(path);
        }

        selected = found;
        lastClick = { path: null, time: 0 };
        for (const path of found) expandTo(path);
        render();
        treeEl.querySelector(".lwt-row.selected")?.scrollIntoView({ block: "center" });

        if (missing.length) {
            toast("warn", `Preset "${preset.name}"`,
                `${missing.length} template(s) not found and skipped: ${missing.join(", ")}`);
        }
        if (!found.length) {
            toast("error", `Preset "${preset.name}"`, "None of its templates exist");
        }
    }

    // Sync the row highlights, order badges and Load button with `selected`.
    function updateSelectionUI() {
        loadBtn.disabled = !selected.length;
        loadBtn.textContent = selected.length > 1 ? `Load (${selected.length})` : "Load";
        for (const row of treeEl.querySelectorAll(".lwt-row[data-path]")) {
            const idx = selected.indexOf(row.dataset.path);
            row.classList.toggle("selected", idx !== -1);
            row.querySelector(".lwt-ord").textContent =
                idx !== -1 && selected.length > 1 ? String(idx + 1) : "";
        }
    }

    // Render one directory level; returns the element, or null when the filter
    // leaves nothing visible underneath it.
    function renderDir(node, dirPath, term, forceExpand) {
        const frag = document.createDocumentFragment();
        let any = false;

        const sortedDirs = [...node.dirs.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));

        for (const [name, child] of sortedDirs) {
            const childPath = dirPath ? `${dirPath}/${name}` : name;
            const childrenEl = renderDir(child, childPath, term, forceExpand);
            if (!childrenEl) continue;
            any = true;

            const isOpen = forceExpand || expanded.has(childPath);

            const row = document.createElement("div");
            row.className = "lwt-row folder";
            row.innerHTML = `<span class="lwt-ico"></span><span></span>`;
            row.querySelector(".lwt-ico").textContent = isOpen ? "▾" : "▸";
            row.querySelector("span:last-child").textContent = name;

            childrenEl.classList.toggle("collapsed", !isOpen);

            row.addEventListener("click", () => {
                const open = expanded.has(childPath);
                if (open) expanded.delete(childPath);
                else expanded.add(childPath);
                childrenEl.classList.toggle("collapsed", open);
                row.querySelector(".lwt-ico").textContent = open ? "▸" : "▾";
            });

            frag.appendChild(row);
            frag.appendChild(childrenEl);
        }

        const files = term
            ? node.files.filter(f => f.name.toLowerCase().includes(term))
            : node.files;

        for (const file of files) {
            any = true;
            const row = document.createElement("div");
            row.className = "lwt-row";
            row.dataset.path = file.path;
            row.innerHTML = `<span class="lwt-ico">▤</span><span></span><span class="lwt-ord"></span>`;
            row.querySelector("span:nth-child(2)").textContent = file.name.replace(/\.json$/i, "");
            row.title = file.path;

            // Plain click selects a single file; a second click on it within
            // 400 ms confirms the load (manual double-click detection — more
            // reliable than the native "dblclick" event, which the browser
            // suppresses when the mouse drifts slightly between clicks).
            // Ctrl/Cmd+click toggles the file in the multi-selection instead.
            row.addEventListener("click", e => {
                // the selection no longer is the preset's one
                presetSelect.value = "";
                if (e.ctrlKey || e.metaKey) {
                    const idx = selected.indexOf(file.path);
                    if (idx === -1) selected.push(file.path);
                    else selected.splice(idx, 1);
                    lastClick = { path: null, time: 0 };
                } else {
                    const now = Date.now();
                    const isDouble = lastClick.path === file.path && now - lastClick.time < 400;
                    lastClick = { path: file.path, time: now };
                    selected = [file.path];
                    if (isDouble) {
                        confirmLoad();
                        return;
                    }
                }
                updateSelectionUI();
            });

            frag.appendChild(row);
        }

        if (!any) return null;
        const wrap = document.createElement("div");
        if (dirPath) wrap.className = "lwt-children";
        wrap.appendChild(frag);
        return wrap;
    }

    function render() {
        const term = filterInput.value.trim().toLowerCase();
        treeEl.innerHTML = "";

        const content = paths.length ? renderDir(tree, "", term, !!term) : null;
        if (content) {
            treeEl.appendChild(content);
        } else {
            const empty = document.createElement("div");
            empty.className = "lwt-empty";
            empty.textContent = paths.length
                ? "No workflows match the filter."
                : `No workflows found in ${templatesDir()}`;
            treeEl.appendChild(empty);
        }

        // Filtering keeps the selection (so entries picked under different
        // filter terms can be combined); hidden picks still count — the Load
        // button label shows how many templates are queued.
        updateSelectionUI();
    }

    const onKey = e => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if (e.key === "Enter" && !loadBtn.disabled) { e.stopPropagation(); confirmLoad(); }
    };

    // Rescan the templates folder and reread the presets file, rebuilding the
    // cached lists, then reopen the dialog with the fresh paths. The current
    // filter text, selection and options are carried over (entries that no
    // longer exist are dropped).
    async function refresh() {
        refreshBtn.classList.add("busy");
        const term = filterInput.value;
        try {
            const [fresh, freshPresets] = await Promise.all([
                fetchTemplateList(true),
                fetchPresetList(true),
            ]);
            close();
            openTemplateDialog(fresh, freshPresets, dropPos, term, [...selected],
                autoConnectInput.checked, presetSelect.value);
        } catch (err) {
            refreshBtn.classList.remove("busy");
            console.error("[LoadWfTemplate] failed to refresh workflows:", err);
            toast("error", "Refresh failed",
                `Could not rescan ${templatesDir()}: ${err.message ?? err}`);
        }
    }

    filterInput.addEventListener("input", render);
    presetSelect.addEventListener("change", () => {
        const preset = presets.find(p => p.name === presetSelect.value);
        if (preset) applyPreset(preset);
    });
    refreshBtn.addEventListener("click", refresh);
    cancelBtn.addEventListener("click", close);
    loadBtn.addEventListener("click", confirmLoad);
    overlay.addEventListener("pointerdown", e => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);

    render();
    document.body.appendChild(overlay);
    // Bring the remembered selection into view (works only once attached).
    treeEl.querySelector(".lwt-row.selected")?.scrollIntoView({ block: "center" });
    filterInput.focus();
}

async function showTemplatePicker(dropPos) {
    try {
        const paths = await fetchTemplateList();
        // A broken/absent presets endpoint must not keep the picker closed: the
        // manual tree selection is the primary way in.
        const presets = await fetchPresetList().catch(err => {
            console.error("[LoadWfTemplate] failed to load presets:", err);
            return [];
        });
        openTemplateDialog(paths, presets, dropPos);
    } catch (err) {
        console.error("[LoadWfTemplate] failed to list workflows:", err);
        toast("error", "Scan failed",
            `Could not list ${templatesDir()}: ${err.message ?? err}`);
    }
}

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".load_template_workflow",

    // Registered command: shows up in the command palette and in
    // Settings → Keybinding, where the default shortcut can be rebound.
    commands: [{
        id: API_PREFIX + ".load_template_workflow.open",
        label: ADDON_PREFIX + " Load template workflow",
        icon: "pi pi-folder-open",
        // graph_mouse holds the last known canvas mouse position, so the
        // nodes are dropped where the mouse hovers when the shortcut is hit.
        function: () => showTemplatePicker([...app.canvas.graph_mouse]),
    }],

    keybindings: [{
        commandId: API_PREFIX + ".load_template_workflow.open",
        combo: { key: "w", alt: true },
    }],
});

// Canvas right-click menu entry, grouped into the addon submenu.
registerCanvasMenu(() => [{
    content: "🧷 Load template workflow",
    // Record the graph-space mouse position now (i.e. where the context menu
    // was opened); the inserted nodes are dropped there.
    callback: () => showTemplatePicker([...app.canvas.graph_mouse]),
}]);
