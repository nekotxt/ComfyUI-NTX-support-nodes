// CREATED WITH CLAUDE

import { app } from "../../../scripts/app.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";

// data types selectable for PipeCustom inputs — edit to customize
export const PIPE_DATA_TYPES = ["IMAGE", "MASK", "LATENT", "MODEL", "CLIP", "VAE", "CONDITIONING",
                                "INT", "FLOAT", "STRING", "BOOLEAN",
                                "LORA_STACK", "CONTROL_NET_STACK", "DICT", "LIST", "*"]
// max custom inputs/outputs per PipeCustom node (mirrored in py/context.py — the
// backend pre-declares this many wildcard outputs, so keep the two values in sync)
export const PIPE_MAX_SLOTS = 30

const NODE_ID = ADDON_PREFIX + "PipeCustom";
const WIDGET_NAME = "inputs_data";
const RESERVED_NAMES = ["pipe", WIDGET_NAME];

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.cpp-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 4px;
    box-sizing: border-box;
    width: 100%;
}

.cpp-edit-btn {
    flex: 1 1 auto;
    height: 24px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
}

.cpp-edit-btn:hover {
    border-color: #4a90d9;
    color: #fff;
}

/* ── Dialog ── */
.cpp-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
}

.cpp-panel {
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

.cpp-title {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 10px;
}

.cpp-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    min-height: 28px;
}

.cpp-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.cpp-name {
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

.cpp-type {
    flex: 0 0 130px;
    height: 24px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    font-size: 12px;
}

.cpp-del {
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

.cpp-del:hover {
    color: #e66;
    border-color: #e66;
}

.cpp-add {
    margin-top: 8px;
    height: 24px;
    background: transparent;
    color: var(--input-text, #ccc);
    border: 1px dashed #555;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.cpp-add:hover:not(:disabled) {
    border-color: #4a90d9;
    color: #fff;
}

.cpp-add:disabled {
    opacity: 0.4;
    cursor: default;
}

.cpp-error {
    color: #e66;
    min-height: 16px;
    margin-top: 6px;
}

.cpp-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
}

.cpp-btn {
    height: 26px;
    padding: 0 16px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.cpp-btn:hover {
    border-color: #4a90d9;
    color: #fff;
}

.cpp-btn.cpp-ok {
    background: #2a4a6a;
}
`;

function injectCSS() {
    if (document.getElementById("cpp-style")) return;
    const style = document.createElement("style");
    style.id = "cpp-style";
    style.textContent = CSS;
    document.head.appendChild(style);
}

// ── Entries (de)serialisation ─────────────────────────────────────────────────
// inputs_data is a JSON string: {"inputs": [{"name": "width", "type": "INT"}, ...],
// "outputs": [...]}. The legacy format (a single list) is applied to both sides.

function parseEntries(list) {
    if (!Array.isArray(list)) list = [];

    const entries = [];
    for (const e of list) {
        if (!e || typeof e !== "object") continue;
        const name = String(e.name ?? "").trim();
        const type = String(e.type ?? "*");
        if (!name || RESERVED_NAMES.includes(name)) continue;
        if (entries.some(x => x.name === name)) continue;
        entries.push({ name, type });
        if (entries.length >= PIPE_MAX_SLOTS) break;
    }
    return entries;
}

function parseData(value) {
    let data;
    try { data = JSON.parse(value); } catch { data = []; }

    if (Array.isArray(data)) {
        // legacy single-list format: same entries for inputs and outputs
        return { inputs: parseEntries(data), outputs: parseEntries(data) };
    }
    if (!data || typeof data !== "object") data = {};
    return { inputs: parseEntries(data.inputs), outputs: parseEntries(data.outputs) };
}

// ── Slot synchronisation ──────────────────────────────────────────────────────
// Slot layout: input 0 = "pipe" (+ the hidden inputs_data widget slot), output 0
// = "pipe"; the custom entries follow, each side driven by its own list. The
// backend node declares PIPE_MAX_SLOTS wildcard outputs — only the configured
// ones are kept visible here, and link indices stay aligned with the execute()
// return tuple.

function customInputIndices(node) {
    const idxs = [];
    (node.inputs ?? []).forEach((slot, i) => {
        if (slot.widget) return;            // widget-backed slot (inputs_data)
        if (slot.name === "pipe") return;   // fixed pipe slot
        idxs.push(i);
    });
    return idxs;
}

function customOutputIndices(node) {
    const idxs = [];
    (node.outputs ?? []).forEach((slot, i) => {
        if (i === 0 && slot.name === "pipe") return;
        idxs.push(i);
    });
    return idxs;
}

function renameSlot(slot, name) {
    if (slot.name !== name) {
        slot.name = name;
        // display name resolves as label || localized_name || name
        slot.label = undefined;
        slot.localized_name = undefined;
    }
}

function syncSlots(node, data) {
    // inputs: drop excess custom slots (from the end, so indices stay valid)
    let idxs = customInputIndices(node);
    while (idxs.length > data.inputs.length) {
        node.removeInput(idxs.pop());
    }
    idxs = customInputIndices(node);
    data.inputs.forEach((e, i) => {
        if (i < idxs.length) {
            const slot = node.inputs[idxs[i]];
            if (slot.type !== e.type) {
                if (slot.link != null) node.disconnectInput(idxs[i]);
                slot.type = e.type;
            }
            renameSlot(slot, e.name);
        } else {
            node.addInput(e.name, e.type);
        }
    });

    // outputs: same logic, driven by their own entry list
    let odxs = customOutputIndices(node);
    while (odxs.length > data.outputs.length) {
        node.removeOutput(odxs.pop());
    }
    odxs = customOutputIndices(node);
    data.outputs.forEach((e, i) => {
        if (i < odxs.length) {
            const slot = node.outputs[odxs[i]];
            if (slot.type !== e.type) {
                node.disconnectOutput(odxs[i]);
                slot.type = e.type;
            }
            renameSlot(slot, e.name);
        } else {
            node.addOutput(e.name, e.type);
        }
    });

    // snap the node height to its content
    requestAnimationFrame(() => {
        const sz = node.computeSize();
        node.setSize([Math.max(node.size[0], sz[0]), sz[1]]);
        app.graph?.setDirtyCanvas(true, true);
    });
}

function slotsMatch(node, data) {
    const idxs = customInputIndices(node);
    const odxs = customOutputIndices(node);
    if (idxs.length !== data.inputs.length || odxs.length !== data.outputs.length) return false;
    return data.inputs.every((e, i) => {
        const inp = node.inputs[idxs[i]];
        return inp.name === e.name && inp.type === e.type;
    }) && data.outputs.every((e, i) => {
        const out = node.outputs[odxs[i]];
        return out.name === e.name && out.type === e.type;
    });
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function openEditDialog(node, widget, kind) {
    injectCSS();

    const label = kind === "outputs" ? "output" : "input";

    // working copy edited in place by the rows
    const work = widget.getData()[kind];

    const overlay = document.createElement("div");
    overlay.className = "cpp-overlay";

    const panel = document.createElement("div");
    panel.className = "cpp-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "cpp-title";
    title.textContent = `${node.title || NODE_ID} — custom ${kind}`;
    panel.appendChild(title);

    const rowsEl = document.createElement("div");
    rowsEl.className = "cpp-rows";
    panel.appendChild(rowsEl);

    const addBtn = document.createElement("button");
    addBtn.className = "cpp-add";
    addBtn.textContent = `+ Add ${label}`;
    panel.appendChild(addBtn);

    // replace the edited list with a copy of the current entries of the other
    // side (takes effect only when the dialog is accepted with OK)
    const otherKind = kind === "outputs" ? "inputs" : "outputs";
    const copyBtn = document.createElement("button");
    copyBtn.className = "cpp-add";
    copyBtn.textContent = `Copy from ${otherKind}`;
    panel.appendChild(copyBtn);

    const errEl = document.createElement("div");
    errEl.className = "cpp-error";
    panel.appendChild(errEl);

    const footer = document.createElement("div");
    footer.className = "cpp-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cpp-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "cpp-btn cpp-ok";
    okBtn.textContent = "OK";
    footer.append(cancelBtn, okBtn);
    panel.appendChild(footer);

    function buildRow(entry, i) {
        const row = document.createElement("div");
        row.className = "cpp-row";

        const nameEl = document.createElement("input");
        nameEl.className = "cpp-name";
        nameEl.type = "text";
        nameEl.placeholder = `${label} name`;
        nameEl.value = entry.name;
        nameEl.addEventListener("input", () => { entry.name = nameEl.value; });

        const typeEl = document.createElement("select");
        typeEl.className = "cpp-type";
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

        const delBtn = document.createElement("button");
        delBtn.className = "cpp-del";
        delBtn.textContent = "✕";
        delBtn.title = `Remove ${label}`;
        delBtn.addEventListener("click", () => {
            work.splice(i, 1);
            renderRows();
        });

        row.append(nameEl, typeEl, delBtn);
        return row;
    }

    function renderRows(focusLast = false) {
        rowsEl.innerHTML = "";
        work.forEach((entry, i) => rowsEl.appendChild(buildRow(entry, i)));
        addBtn.disabled = work.length >= PIPE_MAX_SLOTS;
        addBtn.textContent = addBtn.disabled ? `Max ${PIPE_MAX_SLOTS} ${kind}` : `+ Add ${label}`;
        if (focusLast) rowsEl.querySelector(".cpp-row:last-child .cpp-name")?.focus();
    }

    function validate() {
        const seen = new Set();
        for (const entry of work) {
            const name = entry.name.trim();
            if (!name) return `${label[0].toUpperCase()}${label.slice(1)} names cannot be empty.`;
            if (RESERVED_NAMES.includes(name)) return `"${name}" is a reserved name.`;
            if (seen.has(name)) return `Duplicate ${label} name "${name}".`;
            seen.add(name);
        }
        return null;
    }

    function close() {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
    }

    // names present on both sides should carry the same type — accepted, but
    // warn the user so unintended type changes do not go unnoticed
    function warnTypeMismatches(entries) {
        const otherTypes = new Map(widget.getData()[otherKind].map(e => [e.name, e.type]));
        const mismatches = entries
            .filter(e => otherTypes.has(e.name) && otherTypes.get(e.name) !== e.type)
            .map(e => `"${e.name}" is ${e.type} in ${kind} but ${otherTypes.get(e.name)} in ${otherKind}`);
        if (!mismatches.length) return;
        const detail = mismatches.join("\n");
        const toast = app.extensionManager?.toast;
        if (toast?.add) {
            toast.add({
                severity: "warn",
                summary: `${node.title || NODE_ID}: input/output type mismatch`,
                detail,
                life: 6000,
            });
        } else {
            alert(`Warning — input/output type mismatch:\n${detail}`);
        }
    }

    function apply() {
        const error = validate();
        if (error) {
            errEl.textContent = error;
            return;
        }
        const entries = work.map(e => ({ name: e.name.trim(), type: e.type }));
        warnTypeMismatches(entries);
        widget.setEntries(kind, entries);
        syncSlots(node, widget.getData());
        close();
    }

    function onKeyDown(ev) {
        if (ev.key === "Escape") { ev.stopPropagation(); close(); }
        else if (ev.key === "Enter" && ev.target?.classList?.contains("cpp-name")) { apply(); }
    }

    addBtn.addEventListener("click", () => {
        if (work.length >= PIPE_MAX_SLOTS) return;
        work.push({ name: "", type: PIPE_DATA_TYPES[0] ?? "*" });
        renderRows(true);
    });
    copyBtn.addEventListener("click", () => {
        work.length = 0;
        work.push(...widget.getData()[otherKind]);
        errEl.textContent = "";
        renderRows();
    });
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", apply);
    document.addEventListener("keydown", onKeyDown, true);

    renderRows();
    document.body.appendChild(overlay);
    rowsEl.querySelector(".cpp-name")?.focus();
}

// ── inputs_data widget ────────────────────────────────────────────────────────
// The raw JSON STRING widget is replaced by a compact DOM widget showing only
// the "Edit inputs…" / "Edit outputs…" buttons; the JSON value is kept through
// getValue/setValue so both workflow and prompt serialisation keep working.

function makePipeWidget(node, inputName, initialValue) {
    injectCSS();

    let data = parseData(initialValue);

    const wrap = document.createElement("div");
    wrap.className = "cpp-wrap";

    const inBtn = document.createElement("button");
    inBtn.className = "cpp-edit-btn";
    inBtn.textContent = "Edit inputs…";
    wrap.appendChild(inBtn);

    const outBtn = document.createElement("button");
    outBtn.className = "cpp-edit-btn";
    outBtn.textContent = "Edit outputs…";
    wrap.appendChild(outBtn);

    const widget = node.addDOMWidget(inputName, "PIPE_INPUTS", wrap, {
        getValue() { return JSON.stringify(data); },
        setValue(v) { data = parseData(v); },
    });

    inBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        openEditDialog(node, widget, "inputs");
    });
    outBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        openEditDialog(node, widget, "outputs");
    });

    widget.computeSize = function (width) {
        return [width, 32];
    };

    widget.__isPipeUI = true;
    widget.getData = () => ({
        inputs: data.inputs.map(e => ({ ...e })),
        outputs: data.outputs.map(e => ({ ...e })),
    });
    widget.setEntries = (kind, list) => { data[kind] = list.map(e => ({ ...e })); };

    return widget;
}

function getPipeWidget(node) {
    return node.widgets?.find(w => w.name === WIDGET_NAME);
}

// ── UI rebuild ────────────────────────────────────────────────────────────────
// If the node is re-created from the unpatched Python definition, inputs_data
// shows up as a raw-JSON STRING widget — replace it with the custom widget,
// preserving the value (same recovery strategy as the old lora_stack UI).

function rebuildPipeUI(node, force = false) {
    if (!node.widgets) return;
    const idx = node.widgets.findIndex(w => w.name === WIDGET_NAME);
    if (idx === -1) return;

    const old = node.widgets[idx];
    if (!force && old.__isPipeUI) return;

    let value = old.value ?? "[]";
    if (typeof value !== "string") {
        try { value = JSON.stringify(value); } catch { value = "[]"; }
    }

    try { old.onRemove?.(); } catch { /* ignore */ }
    old.element?.remove?.();
    node.widgets.splice(idx, 1);

    // addDOMWidget appends at the end — move the new widget back to the
    // original slot so widgets_values serialisation order is preserved.
    const widget = makePipeWidget(node, WIDGET_NAME, value);
    const newIdx = node.widgets.indexOf(widget);
    if (newIdx !== -1 && newIdx !== idx) {
        node.widgets.splice(newIdx, 1);
        node.widgets.splice(idx, 0, widget);
    }
}

function installMenu(node) {
    if (node.__cppMenuInstalled) return;
    node.__cppMenuInstalled = true;

    const origGetExtraMenuOptions = node.getExtraMenuOptions;
    node.getExtraMenuOptions = function (canvas, options) {
        const r = origGetExtraMenuOptions?.apply(this, arguments);
        options.push({
            content: ADDON_PREFIX + " Edit pipe inputs…",
            callback: () => {
                const w = getPipeWidget(this);
                if (w?.__isPipeUI) openEditDialog(this, w, "inputs");
            },
        });
        options.push({
            content: ADDON_PREFIX + " Edit pipe outputs…",
            callback: () => {
                const w = getPipeWidget(this);
                if (w?.__isPipeUI) openEditDialog(this, w, "outputs");
            },
        });
        return r;
    };
}

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".context.pipe_custom",

    // Patch the inputs_data input to the custom widget type. Done here rather
    // than in addCustomNodeDefs because beforeRegisterNodeDef also runs when the
    // frontend re-fetches the definitions after a backend restart (reloadNodeDefs),
    // while addCustomNodeDefs only runs on the initial page load.
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_ID || !nodeData.input) return;
        for (const group of ["required", "optional"]) {
            if (nodeData.input[group]?.[WIDGET_NAME]) {
                nodeData.input[group][WIDGET_NAME] = ["PIPE_INPUTS", { default: "[]" }];
            }
        }
    },

    getCustomWidgets() {
        return {
            PIPE_INPUTS(node, inputName, inputData) {
                const widget = makePipeWidget(
                    node,
                    inputName,
                    inputData[1]?.default ?? "[]",
                );
                return { widget };
            },
        };
    },

    nodeCreated(node) {
        if (node.comfyClass !== NODE_ID) return;
        if (node.size[0] < 240) {
            node.setSize([240, node.size[1]]);
        }
        installMenu(node);
        // self-heal: if the widget was built from an unpatched definition as a
        // raw-JSON STRING widget, replace it with the custom UI right away
        rebuildPipeUI(node);
        // a fresh node renders the backend definition, i.e. all PIPE_MAX_SLOTS
        // wildcard outputs — trim slots to the configured entries (none yet).
        // For nodes about to be configure()d from a workflow this also keeps the
        // slot arrays shorter than the serialised ones, so the clone-over-restore
        // cannot leave stale wildcard slots behind.
        const w = getPipeWidget(node);
        syncSlots(node, w?.getData?.() ?? { inputs: [], outputs: [] });
    },

    // Called for every node each time a graph is (re)loaded — repair the UI if
    // deserialisation produced the raw-JSON fallback widget, and reconcile the
    // slots with inputs_data (covers stale or hand-edited workflows).
    loadedGraphNode(node) {
        if (node.comfyClass !== NODE_ID) return;
        rebuildPipeUI(node);
        const w = getPipeWidget(node);
        if (!w?.getData) return;
        const data = w.getData();
        if (!slotsMatch(node, data)) {
            syncSlots(node, data);
        }
    },
});
