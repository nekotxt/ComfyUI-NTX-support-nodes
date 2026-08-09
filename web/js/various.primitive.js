// CREATED WITH CLAUDE
//
// Primitive — a single value whose type is picked per node instance
// (py/various.py, class Primitive).
//
// The python node declares one widget per supported type (int_value,
// float_value, boolean_value, string_value) plus a hidden, socketless
// "primitive_type" combo. This module shows only the widget matching the
// current type, relabels it to "value", and retypes the output slot, so the
// node looks exactly like a core primitive node for the chosen type. Every
// type keeps its own widget, so the backend validates and serializes each
// value under its real type and switching type never mangles the others.
//
// The type — and, for INT/FLOAT, the widget's minimum / maximum / step — are
// edited from the "Edit primitive" entry of the node's RMB menu (added through
// menu.js). The numeric bounds are purely a frontend concern and live in
// node.properties (value_min / value_max / value_step) so they serialize with
// the workflow; the python schema stays wide open on purpose.
//
// Hidden widgets keep their input slot, which litegraph would still offer as a
// link target. They are parked off-node (widget.y) so they are never drawn or
// hovered, and onConnectInput refuses connections to them.

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";

const NODE_ID = ADDON_PREFIX + "Primitive";

const TYPES = ["INT", "FLOAT", "BOOLEAN", "STRING"];
const NUMERIC_TYPES = ["INT", "FLOAT"];

// primitive type → name of the backend widget holding that type's value
const VALUE_WIDGET = {
    INT: "int_value",
    FLOAT: "float_value",
    BOOLEAN: "boolean_value",
    STRING: "string_value",
};
const TYPE_WIDGET = "primitive_type";
const VALUE_LABEL = "value";        // label shown on whichever widget is active

// node.properties keys holding the numeric widget settings
const PROP_MIN = "value_min";
const PROP_MAX = "value_max";
const PROP_STEP = "value_step";

// "no limit": litegraph needs real numbers, and this is the largest integer a
// double represents exactly, so clamping against it is a no-op in practice.
const NO_LIMIT = Number.MAX_SAFE_INTEGER;
const DEFAULT_STEP = { INT: 1, FLOAT: 0.1 };

// Hidden widgets are not laid out, so their y is never refreshed: parking them
// far above the node keeps their input slot out of sight and out of reach.
const HIDDEN_Y = -10000;

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.prim-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
}

.prim-panel {
    width: 320px;
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

.prim-title {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 10px;
}

.prim-rows {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 6px 8px;
}

.prim-rows label {
    color: #aaa;
}

.prim-rows input,
.prim-rows select {
    height: 24px;
    box-sizing: border-box;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    padding: 0 6px;
    font-size: 12px;
}

.prim-rows input:focus,
.prim-rows select:focus {
    border-color: #4a90d9;
    outline: none;
}

.prim-numeric.prim-off {
    display: none;
}

.prim-hint {
    color: #777;
    margin-top: 8px;
}

.prim-error {
    color: #e66;
    min-height: 16px;
    margin-top: 6px;
}

.prim-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
}

.prim-btn {
    height: 26px;
    padding: 0 16px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.prim-btn:hover {
    border-color: #4a90d9;
    color: #fff;
}

.prim-btn.prim-ok {
    background: #2a4a6a;
}
`;

function injectCSS() {
    if (document.getElementById("prim-style")) return;
    const style = document.createElement("style");
    style.id = "prim-style";
    style.textContent = CSS;
    document.head.appendChild(style);
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

// A comma separated slot type ("INT,FLOAT") accepts `type` if it lists it;
// "*" is the wildcard on either side.
function typeAccepts(slotType, type) {
    if (!slotType || slotType === "*" || type === "*") return true;
    return String(slotType)
        .split(",")
        .map((t) => t.trim())
        .some((t) => t === type || t === "*");
}

function settingValue(id, fallback) {
    try {
        const v = app.extensionManager?.setting?.get?.(id);
        return v === undefined || v === null ? fallback : v;
    } catch {
        return fallback;
    }
}

// ── Node state ────────────────────────────────────────────────────────────────

const isPrimitive = (node) => node?.comfyClass === NODE_ID;

const getWidget = (node, name) => node?.widgets?.find((w) => w.name === name);

function getType(node) {
    const value = getWidget(node, TYPE_WIDGET)?.value;
    return TYPES.includes(value) ? value : "FLOAT";
}

// Index of the input slot backing a widget (widget inputs carry {widget:{name}}).
function widgetSlotIndex(node, widgetName) {
    return (node.inputs ?? []).findIndex((slot) => slot?.widget?.name === widgetName);
}

// The numeric widget settings for `type`: whatever the user chose in the
// dialog, falling back to that type's defaults. Kept in one shared set rather
// than one per type, so switching INT ↔ FLOAT carries the range over.
function getSettings(node, type) {
    const props = node.properties ?? {};
    const number = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);

    let min = number(props[PROP_MIN], -NO_LIMIT);
    let max = number(props[PROP_MAX], NO_LIMIT);
    let step = number(props[PROP_STEP], DEFAULT_STEP[type] ?? DEFAULT_STEP.FLOAT);

    if (type === "INT") {
        min = Math.ceil(min);
        max = Math.floor(max);
        step = Math.max(1, Math.round(step));
    } else if (!(step > 0)) {
        step = DEFAULT_STEP.FLOAT;
    }
    if (max < min) max = min;
    return { min, max, step };
}

// Mirror of the core INT/FLOAT widget constructors: litegraph reads `step2` for
// the real increment and the legacy `step` as a 10x value.
function applyNumberOptions(widget, type, settings) {
    const options = (widget.options ??= {});
    options.min = settings.min;
    options.max = settings.max;
    options.step = settings.step * 10;
    options.step2 = settings.step;

    let value = typeof widget.value === "boolean" ? (widget.value ? 1 : 0) : Number(widget.value);
    if (!isFinite(value)) value = 0;

    if (type === "INT") {
        options.precision = 0;
        delete options.round;
        value = Math.round(value);
    } else {
        const precision =
            settingValue("Comfy.FloatRoundingPrecision", 0) ||
            Math.max(0, -Math.floor(Math.log10(settings.step)));
        options.precision = precision;
        if (!settingValue("Comfy.DisableFloatRounding", false) && precision) {
            options.round = Math.pow(10, -precision);
            value = Number((Math.round(value / options.round) * options.round).toFixed(precision));
        } else {
            delete options.round;
        }
    }

    widget.value = Math.min(settings.max, Math.max(settings.min, value));
}

function setWidgetHidden(node, widget, hidden) {
    if (!widget) return;
    widget.hidden = hidden;
    widget.options ??= {};
    widget.options.hidden = hidden;
    if (hidden) widget.y = HIDDEN_Y;   // park the widget's input slot off-node
}

// Bring the node in line with its current primitive_type: one visible value
// widget labelled "value", numeric options from the node properties, and an
// output slot carrying (and showing) the concrete type.
function applyPrimitive(node) {
    if (!node?.widgets) return;

    const type = getType(node);
    const settings = getSettings(node, type);

    setWidgetHidden(node, getWidget(node, TYPE_WIDGET), true);

    for (const candidate of TYPES) {
        const widget = getWidget(node, VALUE_WIDGET[candidate]);
        if (!widget) continue;
        const active = candidate === type;
        setWidgetHidden(node, widget, !active);
        if (!active) continue;
        widget.label = VALUE_LABEL;
        if (NUMERIC_TYPES.includes(candidate)) applyNumberOptions(widget, candidate, settings);
    }

    const output = node.outputs?.[0];
    if (output) {
        output.type = type;      // the python side stays wildcard; links are validated here
        output.label = type;
    }

    node.setDirtyCanvas?.(true, true);
}

// Drop the output wires the new type is not valid for, and any wire feeding a
// value widget that just became hidden.
function pruneLinks(node, type) {
    const graph = node.graph;
    if (!graph) return;

    const output = node.outputs?.[0];
    for (const linkId of [...(output?.links ?? [])]) {
        const link = getLink(graph, linkId);
        if (!link) continue;
        const target = graph.getNodeById(link.target_id);
        const slot = target?.inputs?.[link.target_slot];
        if (slot && !typeAccepts(slot.type, type)) target.disconnectInput(link.target_slot);
    }

    for (const candidate of TYPES) {
        if (candidate === type) continue;
        const index = widgetSlotIndex(node, VALUE_WIDGET[candidate]);
        if (index !== -1 && node.inputs[index].link != null) node.disconnectInput(index);
    }
}

// Carry the value over when the type changes — the user changed the type of
// one value, they did not ask for a different value.
function convertValue(value, type, settings) {
    if (type === "STRING") {
        if (value == null) return "";
        if (typeof value === "boolean") return value ? "true" : "false";
        return String(value);
    }
    if (type === "BOOLEAN") {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        const text = String(value ?? "").trim().toLowerCase();
        return text !== "" && text !== "0" && text !== "false";
    }
    let number = typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
    if (!isFinite(number)) number = 0;
    if (type === "INT") number = Math.round(number);
    return Math.min(settings.max, Math.max(settings.min, number));
}

// Single entry point for the dialog: store the settings, then re-apply.
function setPrimitive(node, type, numeric) {
    const previousType = getType(node);
    const previousValue = getWidget(node, VALUE_WIDGET[previousType])?.value;

    node.properties ??= {};
    if (numeric) {
        node.properties[PROP_MIN] = numeric.min;
        node.properties[PROP_MAX] = numeric.max;
        node.properties[PROP_STEP] = numeric.step;
    }

    const typeWidget = getWidget(node, TYPE_WIDGET);
    if (typeWidget) typeWidget.value = type;

    if (type !== previousType) {
        const widget = getWidget(node, VALUE_WIDGET[type]);
        if (widget) widget.value = convertValue(previousValue, type, getSettings(node, type));
        pruneLinks(node, type);
    }

    applyPrimitive(node);
}

// ── Edit primitive dialog ─────────────────────────────────────────────────────

function openEditDialog(node) {
    injectCSS();
    document.querySelector(".prim-overlay")?.remove();

    const type = getType(node);
    const props = node.properties ?? {};

    const overlay = document.createElement("div");
    overlay.className = "prim-overlay";

    const panel = document.createElement("div");
    panel.className = "prim-panel";
    panel.innerHTML = `
        <div class="prim-title">Edit primitive</div>
        <div class="prim-rows">
            <label for="prim-type">Type</label>
            <select id="prim-type"></select>
            <label class="prim-numeric" for="prim-min">Minimum</label>
            <input class="prim-numeric" id="prim-min" type="number" step="any" placeholder="no limit">
            <label class="prim-numeric" for="prim-max">Maximum</label>
            <input class="prim-numeric" id="prim-max" type="number" step="any" placeholder="no limit">
            <label class="prim-numeric" for="prim-step">Step</label>
            <input class="prim-numeric" id="prim-step" type="number" step="any" placeholder="1">
        </div>
        <div class="prim-hint prim-numeric">Leave minimum / maximum empty for no limit.</div>
        <div class="prim-error"></div>
        <div class="prim-footer">
            <button class="prim-btn prim-cancel">Cancel</button>
            <button class="prim-btn prim-ok">Apply</button>
        </div>`;
    overlay.appendChild(panel);

    const typeSelect = panel.querySelector("#prim-type");
    for (const option of TYPES) {
        const element = document.createElement("option");
        element.value = option;
        element.textContent = option;
        typeSelect.appendChild(element);
    }
    typeSelect.value = type;

    const minInput = panel.querySelector("#prim-min");
    const maxInput = panel.querySelector("#prim-max");
    const stepInput = panel.querySelector("#prim-step");
    const errorEl = panel.querySelector(".prim-error");

    const stored = (key) => (typeof props[key] === "number" && isFinite(props[key]) ? props[key] : null);
    minInput.value = stored(PROP_MIN) ?? "";
    maxInput.value = stored(PROP_MAX) ?? "";
    stepInput.value = stored(PROP_STEP) ?? "";

    // The min/max/step rows only make sense for the numeric types.
    function syncNumericRows() {
        const numeric = NUMERIC_TYPES.includes(typeSelect.value);
        for (const el of panel.querySelectorAll(".prim-numeric")) el.classList.toggle("prim-off", !numeric);
        stepInput.placeholder = String(DEFAULT_STEP[typeSelect.value] ?? DEFAULT_STEP.FLOAT);
    }

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    }

    function confirm() {
        const selected = typeSelect.value;
        let numeric = null;

        if (NUMERIC_TYPES.includes(selected)) {
            // An empty field stays null — "unset" is what getSettings() reads as
            // "no limit" / "this type's default step".
            const parse = (input) => {
                const text = input.value.trim();
                if (text === "") return null;
                const value = Number(text);
                return isFinite(value) ? value : NaN;
            };
            const min = parse(minInput);
            const max = parse(maxInput);
            const step = parse(stepInput);

            if ([min, max, step].some(Number.isNaN)) {
                errorEl.textContent = "Minimum, maximum and step must be numbers.";
                return;
            }
            if ((min ?? -NO_LIMIT) > (max ?? NO_LIMIT)) {
                errorEl.textContent = "The minimum must not be greater than the maximum.";
                return;
            }
            if (!((step ?? DEFAULT_STEP[selected]) > 0)) {
                errorEl.textContent = "The step must be greater than zero.";
                return;
            }
            numeric = { min, max, step };
        }

        close();
        setPrimitive(node, selected, numeric);
    }

    const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if (e.key === "Enter") { e.stopPropagation(); confirm(); }
    };

    typeSelect.addEventListener("change", () => { errorEl.textContent = ""; syncNumericRows(); });
    for (const input of [minInput, maxInput, stepInput]) {
        input.addEventListener("input", () => { errorEl.textContent = ""; });
    }
    panel.querySelector(".prim-cancel").addEventListener("click", close);
    panel.querySelector(".prim-ok").addEventListener("click", confirm);
    overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);

    syncNumericRows();
    document.body.appendChild(overlay);
    typeSelect.focus();
}

// ── Wiring ────────────────────────────────────────────────────────────────────

registerNodeMenu((node) => {
    if (!isPrimitive(node)) return [];
    return [{
        content: "🔢 Edit primitive",
        callback: () => openEditDialog(node),
    }];
});

// A hidden value widget keeps its input slot; refuse links to it so a wire
// dropped on the node body can never land on the type that is not in use.
function installConnectGuard(node) {
    if (node.__primitiveConnectGuard) return;
    node.__primitiveConnectGuard = true;
    const original = node.onConnectInput;
    node.onConnectInput = function (targetSlot) {
        const name = this.inputs?.[targetSlot]?.widget?.name;
        if (name && getWidget(this, name)?.hidden) return false;
        return original ? original.apply(this, arguments) : true;
    };
}

app.registerExtension({
    name: API_PREFIX + ".various.primitive",

    nodeCreated(node) {
        if (!isPrimitive(node)) return;

        installConnectGuard(node);
        applyPrimitive(node);
        node.setSize(node.computeSize());   // drop the height of the widgets just hidden

        // configure() restores the serialized widget values (and node size) after
        // this hook, so re-derive the layout from the loaded primitive_type.
        const original = node.onConfigure;
        node.onConfigure = function () {
            const result = original?.apply(this, arguments);
            applyPrimitive(this);
            return result;
        };
    },
});
