// CREATED WITH CLAUDE
//
// GlobalSet / GlobalGet — multi-slot wireless "named variable" node pair.
//
// GlobalSet holds any number of named, typed inputs; GlobalGet exposes any
// subset of those names as outputs. The pair is linked by NAME only — no wire.
// Both are pure-frontend VIRTUAL nodes (isVirtualNode = true): they are pruned
// from the prompt, and at submission every Get output resolves straight
// through to the real node feeding the same-named Global Set input:
//   - getInputLink(slot)         → same-graph resolution (classic path)
//   - resolveVirtualOutput(slot) → cross-graph / subgraph resolution
// The Python classes in py/global_set_get.py are metadata-only (node library
// entry, search, description) and never execute.
//
// Slot lists are edited in a dialog modeled on the PipeCustom editor
// (web/js/context.pipe_custom.js): one row per slot with name + type, drag to
// reorder, wires preserved across rename/reorder. Names are GLOBAL: a name may
// be defined by only one Global Set in the whole workflow (subgraphs
// included), and a Global Get may only use names some Global Set defines — the
// Get editor autocompletes them and locks each entry's type to the defining
// Set's type.

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, ADDON_NAME, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";
import { PIPE_DATA_TYPES } from "./context.pipe_custom.js";

const NODE_SET = ADDON_PREFIX + "GlobalSet";
const NODE_GET = ADDON_PREFIX + "GlobalGet";
const CATEGORY = ADDON_NAME + "/reroute";
const MAX_SLOTS = 30;        // UI sanity cap — the nodes are virtual, there is no backend limit
const PROP_NAME = "slots";   // node.properties.slots = [{name, type}, ...]

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.gsg-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
}

.gsg-panel {
    width: 380px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--comfy-menu-bg, #202020);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    font-size: 12px;
}

.gsg-title {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 10px;
}

.gsg-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    min-height: 28px;
}

.gsg-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.gsg-row.gsg-dragging {
    opacity: 0.4;
}

/* drop position indicators (set during a drag-over) */
.gsg-row.gsg-drop-before {
    box-shadow: 0 -2px 0 0 #4a90d9;
}

.gsg-row.gsg-drop-after {
    box-shadow: 0 2px 0 0 #4a90d9;
}

.gsg-drag {
    flex: 0 0 16px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    cursor: grab;
    font-size: 14px;
    line-height: 1;
    user-select: none;
}

.gsg-drag:hover {
    color: #fff;
}

.gsg-drag:active {
    cursor: grabbing;
}

.gsg-name {
    flex: 1 1 0;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    padding: 0 6px;
    font-size: 12px;
}

.gsg-type {
    flex: 0 0 130px;
    height: 24px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    font-size: 12px;
}

.gsg-type:disabled {
    opacity: 0.7;
}

.gsg-del {
    flex: 0 0 24px;
    height: 24px;
    background: transparent;
    color: #888;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
}

.gsg-del:hover {
    color: #e66;
    border-color: #e66;
}

.gsg-add {
    margin-top: 8px;
    height: 24px;
    background: transparent;
    color: var(--input-text, #ccc);
    border: 1px dashed #555;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.gsg-add:hover:not(:disabled) {
    border-color: #4a90d9;
    color: #fff;
}

.gsg-add:disabled {
    opacity: 0.4;
    cursor: default;
}

.gsg-error {
    color: #e66;
    min-height: 16px;
    margin-top: 6px;
}

.gsg-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
}

.gsg-btn {
    height: 26px;
    padding: 0 16px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.gsg-btn:hover {
    border-color: #4a90d9;
    color: #fff;
}

.gsg-btn.gsg-ok {
    background: #2a4a6a;
}
`;

function injectCSS() {
    if (document.getElementById("gsg-style")) return;
    const style = document.createElement("style");
    style.id = "gsg-style";
    style.textContent = CSS;
    document.head.appendChild(style);
}

function toast(severity, summary, detail) {
    const t = app.extensionManager?.toast;
    if (t?.add) {
        t.add({ severity, summary, detail, life: 6000 });
    } else {
        alert(detail ? `${summary}\n${detail}` : summary);
    }
}

// ── Graph helpers ─────────────────────────────────────────────────────────────

// Compat: graph.links/_links may be a Map or a plain object depending on the
// litegraph version. `== null` intentionally catches both null and undefined.
function getLink(graph, linkId) {
    if (!graph || linkId == null) return null;
    if (typeof graph.getLink === "function") return graph.getLink(linkId);
    const store = graph._links ?? graph.links;
    if (store instanceof Map) return store.get(linkId) ?? null;
    return store?.[linkId] ?? null;
}

// All descendant subgraphs of a graph, walking real SubgraphNode.subgraph
// references so arbitrary nesting depth is handled.
function getGraphDescendants(graph, _visited) {
    if (!graph?._nodes) return [];
    const visited = _visited || new Set();
    if (visited.has(graph)) return [];
    visited.add(graph);
    const out = [];
    for (const n of graph._nodes) {
        if (n.subgraph && !visited.has(n.subgraph)) {
            out.push(n.subgraph);
            out.push(...getGraphDescendants(n.subgraph, visited));
        }
    }
    return out;
}

// Every live graph in the workflow: root + every nested subgraph, at any depth.
function allLiveGraphs(graph) {
    if (!graph) return [];
    const root = graph.rootGraph || graph;
    return [root, ...getGraphDescendants(root)];
}

// Every GlobalSet input across the whole workflow, as a Map
// name → {node, graph, slotIndex, type}. First definition wins (names are kept
// globally unique by the editor, so duplicates only exist transiently).
// `excludeNode` leaves one Set out — used to validate that Set's own names.
function collectSetEntries(graph, excludeNode) {
    const map = new Map();
    for (const g of allLiveGraphs(graph)) {
        for (const node of g._nodes ?? []) {
            if (node.type !== NODE_SET || node === excludeNode) continue;
            (node.inputs ?? []).forEach((slot, i) => {
                if (slot.name && !map.has(slot.name)) {
                    map.set(slot.name, { node, graph: g, slotIndex: i, type: slot.type });
                }
            });
        }
    }
    return map;
}

// The GlobalSet input slot defining `name`, preferring the Get's own graph so
// a (transient) duplicate in another graph cannot shadow the local one.
function findSetSlotByName(graph, name) {
    if (!name) return null;
    const graphs = allLiveGraphs(graph);
    graphs.sort((a, b) => (a === graph ? -1 : 0) - (b === graph ? -1 : 0));
    for (const g of graphs) {
        for (const node of g._nodes ?? []) {
            if (node.type !== NODE_SET) continue;
            const slotIndex = (node.inputs ?? []).findIndex((s) => s.name === name);
            if (slotIndex >= 0) return { node, graph: g, slotIndex, type: node.inputs[slotIndex].type };
        }
    }
    return null;
}

// Every GlobalGet node across the whole workflow.
function allGetNodes(graph) {
    const out = [];
    for (const g of allLiveGraphs(graph)) {
        for (const node of g._nodes ?? []) {
            if (node.type === NODE_GET) out.push(node);
        }
    }
    return out;
}

// ── Entries (properties.slots) ────────────────────────────────────────────────

function normalizeEntries(raw) {
    if (!Array.isArray(raw)) raw = [];
    const entries = [];
    for (const e of raw) {
        if (!e || typeof e !== "object") continue;
        const name = String(e.name ?? "").trim();
        const type = String(e.type ?? "*") || "*";
        if (!name || entries.some((x) => x.name === name)) continue;
        entries.push({ name, type });
        if (entries.length >= MAX_SLOTS) break;
    }
    return entries;
}

function getEntries(node) {
    return normalizeEntries(node.properties?.[PROP_NAME]);
}

function setEntries(node, entries) {
    node.properties = node.properties || {};
    node.properties[PROP_NAME] = entries.map((e) => ({ name: e.name, type: e.type }));
}

// ── Link-preserving slot synchronisation ──────────────────────────────────────
// Same strategy as the PipeCustom editor: keep the existing slot OBJECTS
// (matched by name, refined by the editor's rename map), move them into entry
// order, and patch each link's slot-index field to the slot's new position.
// A type change keeps the slot but drops the wire(s).

// rename a slot in place, keeping any display label in sync
function renameSlot(slot, name) {
    if (slot.label != null) slot.label = name;
    if (slot.localized_name != null) slot.localized_name = name;
    slot.name = name;
}

// Pull the slot for entry `e` out of `byName`. A recorded rename (new name →
// name at dialog-open) takes precedence over a direct name match so that
// swapped or chained renames each reclaim their own slot.
function takeSlot(byName, e, renames) {
    const orig = renames?.get(e.name);
    if (orig !== undefined) {
        const slot = byName.get(orig);
        if (slot) {
            byName.delete(orig);
            if (slot.name !== e.name) renameSlot(slot, e.name);
            return slot;
        }
    }
    const slot = byName.get(e.name);
    if (slot) byName.delete(e.name);
    return slot;
}

function syncInputSlots(node, entries, renames) {
    const byName = new Map((node.inputs ?? []).map((s) => [s.name, s]));

    const ordered = [];
    for (const e of entries) {
        let slot = takeSlot(byName, e, renames);
        if (slot) {
            if (slot.type !== e.type) {                      // type changed → drop the wire
                const idx = node.inputs.indexOf(slot);
                if (slot.link != null && idx !== -1) node.disconnectInput(idx);
                slot.type = e.type;
            }
        } else {
            node.addInput(e.name, e.type);                   // new entry → fresh slot
            slot = node.inputs[node.inputs.length - 1];
        }
        ordered.push(slot);
    }

    // entries removed: drop their slots (also disconnects their wires)
    for (const slot of byName.values()) {
        const idx = node.inputs.indexOf(slot);
        if (idx !== -1) node.removeInput(idx);
    }

    node.inputs.splice(0, node.inputs.length, ...ordered);

    // realign each input wire's target_slot with its slot's final index
    node.inputs.forEach((slot, i) => {
        const link = getLink(node.graph, slot.link);
        if (link) link.target_slot = i;
    });
}

function syncOutputSlots(node, entries, renames) {
    const byName = new Map((node.outputs ?? []).map((s) => [s.name, s]));

    const ordered = [];
    for (const e of entries) {
        let slot = takeSlot(byName, e, renames);
        if (slot) {
            if (slot.type !== e.type) {                      // type changed → drop the wire(s)
                const idx = node.outputs.indexOf(slot);
                if (slot.links?.length && idx !== -1) node.disconnectOutput(idx);
                slot.type = e.type;
            }
        } else {
            node.addOutput(e.name, e.type);
            slot = node.outputs[node.outputs.length - 1];
        }
        ordered.push(slot);
    }

    for (const slot of byName.values()) {
        const idx = node.outputs.indexOf(slot);
        if (idx !== -1) node.removeOutput(idx);
    }

    node.outputs.splice(0, node.outputs.length, ...ordered);

    // realign each output wire's origin_slot with its slot's final index
    node.outputs.forEach((slot, i) => {
        for (const id of slot.links ?? []) {
            const link = getLink(node.graph, id);
            if (link) link.origin_slot = i;
        }
    });
}

// Rebuild the node's slots from properties.slots (link-preserving).
function syncSlots(node, renames) {
    const entries = getEntries(node);
    if (node.type === NODE_SET) syncInputSlots(node, entries, renames);
    else syncOutputSlots(node, entries, renames);

    // snap the node height to its content
    requestAnimationFrame(() => {
        const sz = node.computeSize();
        node.setSize([Math.max(node.size[0], sz[0]), sz[1]]);
        app.graph?.setDirtyCanvas(true, true);
    });
}

function slotsMatch(node, entries) {
    const slots = (node.type === NODE_SET ? node.inputs : node.outputs) ?? [];
    if (slots.length !== entries.length) return false;
    return entries.every((e, i) => slots[i].name === e.name && slots[i].type === e.type);
}

// ── Set-change propagation ────────────────────────────────────────────────────
// After a Global Set edit, every Global Get is reconciled:
//   • renamed entries: Gets using the old name follow it (slots + wires kept),
//     unless the old name is still defined (e.g. a rename+re-add swap)
//   • type changes: the Get entry/slot takes the Set's type (wires dropped by
//     the slot sync, as they are no longer valid)
//   • removed entries: the Get keeps the stale slot, reported with a warning
//     toast so a typo or an accidental removal does not go unnoticed

function propagateSetChanges(node, renames) {
    const graph = node.graph;
    if (!graph) return;

    const defs = collectSetEntries(graph);   // post-edit definitions (this Set included)

    // real renames only: old name gone, new name defined
    const origToNew = new Map();
    for (const [nw, orig] of renames ?? []) {
        if (nw !== orig && !defs.has(orig)) origToNew.set(orig, nw);
    }

    const stale = [];
    for (const getNode of allGetNodes(graph)) {
        const entries = getEntries(getNode);
        const nodeRenames = new Map();
        let changed = false;
        for (const e of entries) {
            const nw = origToNew.get(e.name);
            if (nw && !entries.some((x) => x.name === nw)) {
                nodeRenames.set(nw, e.name);
                e.name = nw;
                changed = true;
            }
            const def = defs.get(e.name);
            if (!def) {
                stale.push(`${getNode.title || "Global Get"} (#${getNode.id}) : ${e.name}`);
                continue;
            }
            if (def.type !== e.type) {
                e.type = def.type;
                changed = true;
            }
        }
        if (changed) {
            setEntries(getNode, entries);
            syncSlots(getNode, nodeRenames);
        }
    }

    if (stale.length) {
        toast("warn", "Global Get names no longer defined", stale.join("\n"));
    }
}

// ── Paste / clone de-duplication ──────────────────────────────────────────────
// A pasted or cloned Global Set carries the same names as the original, which
// would violate global uniqueness — rename each conflicting entry (foo → foo_2,
// foo_3, ...) as soon as the node lands in a graph.

function dedupSetNames(node) {
    if (!node.graph) return;
    const taken = collectSetEntries(node.graph, node);
    const entries = getEntries(node);
    const renames = new Map();
    const local = new Set();
    let changed = false;

    for (const e of entries) {
        if (taken.has(e.name) || local.has(e.name)) {
            const base = e.name.replace(/_\d+$/, "");
            let i = 2;
            let candidate = `${base}_${i}`;
            while (taken.has(candidate) || local.has(candidate)) {
                i++;
                candidate = `${base}_${i}`;
            }
            renames.set(candidate, e.name);
            e.name = candidate;
            changed = true;
        }
        local.add(e.name);
    }

    if (changed) {
        setEntries(node, entries);
        syncSlots(node, renames);
    }
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function openEditDialog(node) {
    injectCSS();

    const isSet = node.type === NODE_SET;
    const kind = isSet ? "inputs" : "outputs";
    const label = isSet ? "input" : "output";

    // names a Get may use (name → type), read fresh at dialog-open
    const defs = isSet ? null : collectSetEntries(node.graph);
    // names this Set may NOT use (defined by other Sets)
    const taken = isSet ? collectSetEntries(node.graph, node) : null;

    // working copy edited in place by the rows; each entry remembers the name
    // it had when the dialog opened, so apply() can tell a rename apart from a
    // remove+add (renamed entries keep their slot and wires)
    const work = getEntries(node);
    for (const e of work) e.__orig = e.name;

    const overlay = document.createElement("div");
    overlay.className = "gsg-overlay";

    const panel = document.createElement("div");
    panel.className = "gsg-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "gsg-title";
    title.textContent = `${node.title || node.type} — global ${kind}`;
    panel.appendChild(title);

    // autocompletion for the Get name fields: the names defined by Global Sets
    const DATALIST_ID = "gsg-name-suggestions";
    if (defs) {
        const dataList = document.createElement("datalist");
        dataList.id = DATALIST_ID;
        for (const name of defs.keys()) {
            const opt = document.createElement("option");
            opt.value = name;
            dataList.appendChild(opt);
        }
        panel.appendChild(dataList);
    }

    const rowsEl = document.createElement("div");
    rowsEl.className = "gsg-rows";
    panel.appendChild(rowsEl);

    const addBtn = document.createElement("button");
    addBtn.className = "gsg-add";
    addBtn.textContent = `+ Add ${label}`;
    panel.appendChild(addBtn);

    // Get only: one click to expose every defined name not already present
    let addAllBtn = null;
    if (defs) {
        addAllBtn = document.createElement("button");
        addAllBtn.className = "gsg-add";
        addAllBtn.textContent = "Add all Set names";
        panel.appendChild(addAllBtn);
    }

    const errEl = document.createElement("div");
    errEl.className = "gsg-error";
    panel.appendChild(errEl);

    const footer = document.createElement("div");
    footer.className = "gsg-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "gsg-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "gsg-btn gsg-ok";
    okBtn.textContent = "OK";
    footer.append(cancelBtn, okBtn);
    panel.appendChild(footer);

    // index of the row currently being dragged (null when no drag in progress)
    let dragIndex = null;

    function clearDropMarkers() {
        rowsEl.querySelectorAll(".gsg-row").forEach((r) =>
            r.classList.remove("gsg-drop-before", "gsg-drop-after"));
    }

    // move the entry at `from` so it lands at array position `to` (0..length)
    function moveEntry(from, to) {
        if (from < 0 || from >= work.length) return;
        const [item] = work.splice(from, 1);
        if (from < to) to -= 1;             // removal shifted later indices down
        to = Math.max(0, Math.min(to, work.length));
        if (to === from) { work.splice(from, 0, item); return; }
        work.splice(to, 0, item);
        renderRows();
    }

    function buildRow(entry, i) {
        const row = document.createElement("div");
        row.className = "gsg-row";

        const handle = document.createElement("div");
        handle.className = "gsg-drag";
        handle.textContent = "⠿";
        handle.title = "Drag to reorder";
        handle.draggable = true;
        handle.addEventListener("dragstart", (ev) => {
            dragIndex = i;
            row.classList.add("gsg-dragging");
            ev.dataTransfer.effectAllowed = "move";
            // Firefox requires some data to be set for the drag to start
            try { ev.dataTransfer.setData("text/plain", String(i)); } catch { /* ignore */ }
            try { ev.dataTransfer.setDragImage(row, 0, 0); } catch { /* ignore */ }
        });
        handle.addEventListener("dragend", () => {
            dragIndex = null;
            row.classList.remove("gsg-dragging");
            clearDropMarkers();
        });

        // a drop lands relative to whichever row the cursor is over
        row.addEventListener("dragover", (ev) => {
            if (dragIndex === null) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "move";
            const rect = row.getBoundingClientRect();
            const after = ev.clientY > rect.top + rect.height / 2;
            clearDropMarkers();
            row.classList.add(after ? "gsg-drop-after" : "gsg-drop-before");
        });
        row.addEventListener("drop", (ev) => {
            if (dragIndex === null) return;
            ev.preventDefault();
            const rect = row.getBoundingClientRect();
            const after = ev.clientY > rect.top + rect.height / 2;
            const from = dragIndex;
            dragIndex = null;
            clearDropMarkers();
            moveEntry(from, after ? i + 1 : i);
        });

        const nameEl = document.createElement("input");
        nameEl.className = "gsg-name";
        nameEl.type = "text";
        nameEl.placeholder = `${label} name`;
        nameEl.value = entry.name;
        if (defs) {
            nameEl.setAttribute("list", DATALIST_ID);
            nameEl.setAttribute("autocomplete", "off");
        }

        const typeEl = document.createElement("select");
        typeEl.className = "gsg-type";
        const types = PIPE_DATA_TYPES.includes(entry.type)
            ? PIPE_DATA_TYPES
            : [entry.type, ...PIPE_DATA_TYPES];   // keep unknown/customized types selectable
        for (const t of types) {
            const opt = document.createElement("option");
            opt.value = t;
            opt.textContent = t;
            typeEl.appendChild(opt);
        }
        typeEl.value = entry.type;
        typeEl.addEventListener("change", () => { entry.type = typeEl.value; });

        // select `t` in the dropdown, adding it first if it is not a stock type
        function setTypeValue(t) {
            if (![...typeEl.options].some((o) => o.value === t)) {
                const opt = document.createElement("option");
                opt.value = t;
                opt.textContent = t;
                typeEl.insertBefore(opt, typeEl.firstChild);
            }
            typeEl.value = t;
        }

        // Get entries: the type is dictated by the defining Set — lock the
        // dropdown whenever the name is recognized
        function refreshTypeLock() {
            if (!defs) return;
            const def = defs.get(entry.name.trim());
            if (def) {
                entry.type = def.type;
                setTypeValue(def.type);
                typeEl.disabled = true;
                typeEl.title = "Type taken from the Global Set defining this name";
            } else {
                typeEl.disabled = false;
                typeEl.title = "";
            }
        }

        nameEl.addEventListener("input", () => {
            entry.name = nameEl.value;
            refreshTypeLock();
        });
        refreshTypeLock();

        const delBtn = document.createElement("button");
        delBtn.className = "gsg-del";
        delBtn.textContent = "✕";
        delBtn.title = `Remove ${label}`;
        delBtn.addEventListener("click", () => {
            work.splice(i, 1);
            renderRows();
        });

        row.append(handle, nameEl, typeEl, delBtn);
        return row;
    }

    function renderRows(focusLast = false) {
        rowsEl.innerHTML = "";
        work.forEach((entry, i) => rowsEl.appendChild(buildRow(entry, i)));
        addBtn.disabled = work.length >= MAX_SLOTS;
        addBtn.textContent = addBtn.disabled ? `Max ${MAX_SLOTS} ${kind}` : `+ Add ${label}`;
        if (focusLast) rowsEl.querySelector(".gsg-row:last-child .gsg-name")?.focus();
    }

    function validate() {
        const seen = new Set();
        for (const entry of work) {
            const name = entry.name.trim();
            if (!name) return `${label[0].toUpperCase()}${label.slice(1)} names cannot be empty.`;
            if (seen.has(name)) return `Duplicate ${label} name "${name}".`;
            seen.add(name);
            if (taken?.has(name)) {
                const other = taken.get(name).node;
                return `"${name}" is already defined by another Global Set (#${other.id}).`;
            }
            if (defs && !defs.has(name)) return `"${name}" is not defined by any Global Set.`;
        }
        return null;
    }

    function close() {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
    }

    function apply() {
        const error = validate();
        if (error) {
            errEl.textContent = error;
            return;
        }
        const entries = work.map((e) => {
            const name = e.name.trim();
            // a Get slot always carries the defining Set's type
            const type = defs ? (defs.get(name)?.type ?? e.type) : e.type;
            return { name, type };
        });

        // slot-matching map (current name → name at dialog-open); rows added in
        // this session carry no __orig and simply match by name
        const renames = new Map();
        for (const e of work) {
            if (e.__orig) renames.set(e.name.trim(), e.__orig);
        }

        setEntries(node, entries);
        syncSlots(node, renames);

        if (isSet) propagateSetChanges(node, renames);
        close();
    }

    function onKeyDown(ev) {
        if (ev.key === "Escape") { ev.stopPropagation(); close(); }
        else if (ev.key === "Enter" && ev.target?.classList?.contains("gsg-name")) { apply(); }
    }

    addBtn.addEventListener("click", () => {
        if (work.length >= MAX_SLOTS) return;
        work.push({ name: "", type: PIPE_DATA_TYPES[0] ?? "*" });
        renderRows(true);
    });
    addAllBtn?.addEventListener("click", () => {
        const existing = new Set(work.map((e) => e.name.trim()));
        for (const [name, def] of defs) {
            if (work.length >= MAX_SLOTS) break;
            if (existing.has(name)) continue;
            work.push({ name, type: def.type });
            existing.add(name);
        }
        renderRows();
    });
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", apply);
    document.addEventListener("keydown", onKeyDown, true);

    renderRows();
    document.body.appendChild(overlay);
    rowsEl.querySelector(".gsg-name")?.focus();
}

// ── Node classes ──────────────────────────────────────────────────────────────

function registerGlobalSetNode() {
    const LGraphNode = LiteGraph.LGraphNode;

    class GlobalSetNode extends LGraphNode {
        static title = "Global Set";
        static category = CATEGORY;

        constructor(title) {
            super(title);
            // isVirtualNode → pruned from the prompt; resolved on the frontend only.
            this.isVirtualNode = true;
            this.serialize_widgets = false;   // the button holds no state; entries live in properties
            this.comfyClass = NODE_SET;

            this.properties = this.properties || {};
            if (!Array.isArray(this.properties[PROP_NAME])) this.properties[PROP_NAME] = [];

            this.addWidget("button", "Edit inputs…", null, () => openEditDialog(this));
            if (this.size[0] < 200) this.size[0] = 200;
        }

        onAdded() {
            this._justAdded = true;
            // clone path: configure() ran BEFORE the node was added — the copied
            // names are already on the node, de-duplicate them now
            if (!app.configuringGraph) dedupSetNames(this);
        }

        onConfigure() {
            if (!Array.isArray(this.properties?.[PROP_NAME])) {
                this.properties = this.properties || {};
                this.properties[PROP_NAME] = [];
            }
            // reconcile slots with properties (covers hand-edited workflows)
            if (!slotsMatch(this, getEntries(this))) syncSlots(this);
            // paste path: added first, then configured — de-duplicate the names
            // the paste just restored
            if (this._justAdded && this.graph && !app.configuringGraph) dedupSetNames(this);
            this._justAdded = false;
        }
    }

    LiteGraph.registerNodeType(NODE_SET, GlobalSetNode);
}

function registerGlobalGetNode() {
    const LGraphNode = LiteGraph.LGraphNode;

    class GlobalGetNode extends LGraphNode {
        static title = "Global Get";
        static category = CATEGORY;

        constructor(title) {
            super(title);
            this.isVirtualNode = true;
            this.serialize_widgets = false;
            this.comfyClass = NODE_GET;

            this.properties = this.properties || {};
            if (!Array.isArray(this.properties[PROP_NAME])) this.properties[PROP_NAME] = [];

            this.addWidget("button", "Edit outputs…", null, () => openEditDialog(this));
            if (this.size[0] < 200) this.size[0] = 200;
        }

        // Classic prompt path: same-graph resolution. Returns the link feeding
        // the same-named Global Set input, so the prompt builder reads straight
        // through to the real source. `slot` is this node's OUTPUT slot index.
        getInputLink(slot) {
            const name = this.outputs?.[slot]?.name;
            if (!name || !this.graph) return null;
            for (const node of this.graph._nodes ?? []) {
                if (node.type !== NODE_SET) continue;
                const idx = (node.inputs ?? []).findIndex((s) => s.name === name);
                if (idx < 0) continue;
                return getLink(this.graph, node.inputs[idx].link);
            }
            return null;
        }

        // Subgraph-aware path: returns the REAL source {node, slot} when the
        // defining Set lives in a DIFFERENT graph; returns undefined for
        // same-graph so the classic getInputLink path above handles it.
        resolveVirtualOutput(slot) {
            const name = this.outputs?.[slot]?.name;
            if (!name) return undefined;
            const entry = findSetSlotByName(this.graph, name);
            if (!entry || entry.graph === this.graph) return undefined;
            const slotInfo = entry.node.inputs[entry.slotIndex];
            if (slotInfo?.link == null) return undefined;
            const link = getLink(entry.graph, slotInfo.link);
            if (!link) return undefined;
            const src = entry.graph.getNodeById(link.origin_id);
            if (!src) return undefined;
            return { node: src, slot: link.origin_slot };
        }

        onConfigure() {
            if (!Array.isArray(this.properties?.[PROP_NAME])) {
                this.properties = this.properties || {};
                this.properties[PROP_NAME] = [];
            }
            if (!slotsMatch(this, getEntries(this))) syncSlots(this);
        }
    }

    LiteGraph.registerNodeType(NODE_GET, GlobalGetNode);
}

// ── RMB menu entries (grouped into the addon submenu via menu.js) ─────────────

function jumpToNode(entry) {
    const canvas = app.canvas;
    if (!canvas || !entry) return;
    if (entry.graph !== canvas.graph && canvas.setGraph) {
        canvas.setGraph(entry.graph);
        setTimeout(() => {
            canvas.centerOnNode?.(entry.node);
            canvas.selectNode?.(entry.node, false);
            canvas.setDirty(true, true);
        }, 0);
    } else {
        canvas.centerOnNode?.(entry.node);
        canvas.selectNode?.(entry.node, false);
        canvas.setDirty(true, true);
    }
}

registerNodeMenu((node) => {
    if (node?.type === NODE_SET) {
        const myNames = new Set(getEntries(node).map((e) => e.name));
        const gets = (node.graph?._nodes ?? []).filter(
            (n) => n.type === NODE_GET && getEntries(n).some((e) => myNames.has(e.name)));
        return [
            {
                content: "Edit global inputs…",
                callback: () => openEditDialog(node),
            },
            {
                content: `Select its Get nodes (${gets.length})`,
                disabled: gets.length === 0,
                callback: () => {
                    const canvas = app.canvas;
                    if (gets.length && canvas?.selectNodes) {
                        canvas.selectNodes(gets);
                    } else if (gets.length && canvas?.selectNode) {
                        canvas.deselectAllNodes?.();
                        for (const n of gets) canvas.selectNode(n, true);
                    }
                    canvas?.setDirty(true, true);
                },
            },
        ];
    }

    if (node?.type === NODE_GET) {
        const items = [
            {
                content: "Edit global outputs…",
                callback: () => openEditDialog(node),
            },
        ];
        const entries = getEntries(node);
        const jumps = entries
            .map((e) => {
                const def = findSetSlotByName(node.graph, e.name);
                return def ? { content: e.name, callback: () => jumpToNode(def) } : null;
            })
            .filter(Boolean);
        if (jumps.length) {
            items.push({
                content: "Jump to Global Set",
                has_submenu: true,
                submenu: { options: jumps },
            });
        }
        return items;
    }

    return [];
});

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".global_set_get",
    // registerCustomNodes runs AFTER the backend defs are registered, so these
    // classes replace the ones ComfyUI generated from py/global_set_get.py —
    // the library entry (name, category, description) stays, the behavior is ours.
    registerCustomNodes() {
        registerGlobalSetNode();
        registerGlobalGetNode();
    },
});
