// CREATED WITH CLAUDE
//
// Clip panel of the Media H3 Script node (py/media_h3_script.py, class
// MediaH3Script).
//
// The python node holds a string widget, clips_state, a JSON object with the
// clips of the script and the index of the active one :
//   {"active": 0, "clips": [{"wf_type", "duration", "prompt_base", "prompt_final"}, ...]}
// It is replaced on the node by a panel (a DOM widget keeping the JSON as its
// value) : a row of tabs, one per clip numbered from 1, with "+" (add a clip
// after the last one, taking the workflow type and duration of the active clip)
// and "−" (remove the active clip), then the fields of the active clip :
// wf_type, duration, the Picture / Video / Audio tag buttons, prompt_base and
// prompt_final. The tag buttons are the Media Parser's (media_parser.tag_picker.js) :
// the chosen "@tag" always goes into prompt_base, at its cursor, prompt_final
// not being parsed by the node. The active tab is the
// clip a run works on.
//
// The node's RMB menu has "Create upstream nodes" : a Media Loader on the media
// input, an Image Resolution on width and height, a Pipe Custom (inputs stack1,
// stack2, stack3 of LORA_STACK) fed by a Lora Stack on lora_stacks, each one
// only when its input is not linked yet (width and height : when neither is).

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { el, toast, NODE_ID as LOADER_NODE_ID } from "./media_loader.js";
import { BUTTONS, openTagMenu, spliceTag } from "./media_parser.tag_picker.js";
import { setPipeInputs } from "./context.pipe_custom.js";
import { registerNodeMenu } from "./menu.js";

const NODE_ID = ADDON_PREFIX + "MediaH3Script";
const WIDGET_NAME = "clips_state";
const WIDGET_TYPE = "NTX_H3_CLIPS";
const NODE_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 340;

// python twins : WF_TYPES, DEFAULT_CLIP, MIN_DURATION, MAX_DURATION
const WF_TYPES = ["T2VA", "I2VA", "L2VA", "FL2VA", "Ref2VA"];
const DEFAULT_DURATION = 5;
const MIN_DURATION = 1;
const MAX_DURATION = 600;
const PROMPTS = ["prompt_base", "prompt_final"];

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.nhs-panel {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    font-family: sans-serif;
    font-size: 12px;
    color: var(--input-text, #c8cfda);
}
.nhs-tabs { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.nhs-tabs button, .nhs-tagbtns button {
    min-width: 26px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--border-color, #3a4150);
    border-radius: 5px;
    background: var(--comfy-input-bg, #1e232c);
    color: var(--input-text, #c8cfda);
    font-size: 12px;
    cursor: pointer;
}
.nhs-tabs button:hover, .nhs-tagbtns button:hover { filter: brightness(1.3); }
.nhs-tabs button.active { background: #3d6fb6; border-color: #5a8ad0; color: #fff; }
.nhs-tabs button:disabled { opacity: .4; cursor: default; filter: none; }
.nhs-tabs .nhs-sep { flex: 1; }
.nhs-row { display: flex; gap: 8px; align-items: center; }
.nhs-row label { color: #8b94a4; font-size: 11px; }
.nhs-row select, .nhs-row input {
    height: 22px;
    box-sizing: border-box;
    border: 1px solid var(--border-color, #3a4150);
    border-radius: 5px;
    background: var(--comfy-input-bg, #1e232c);
    color: var(--input-text, #c8cfda);
    font-size: 12px;
}
.nhs-row select { flex: 1; min-width: 0; }
.nhs-row input { width: 64px; }
.nhs-tagbtns { display: flex; gap: 4px; }
.nhs-tagbtns button { flex: 1; min-width: 0; }
.nhs-label { color: #8b94a4; font-size: 11px; margin-bottom: -2px; }
.nhs-panel textarea {
    flex: 1;
    min-height: 48px;
    resize: none;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid var(--border-color, #3a4150);
    border-radius: 5px;
    background: var(--comfy-input-bg, #1e232c);
    color: var(--input-text, #c8cfda);
    font-family: inherit;
    font-size: 12px;
}
.nhs-panel textarea.final { flex: 1.5; }
`;

let cssInjected = false;
function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
}

// ── State ─────────────────────────────────────────────────────────────────────

function clampDuration(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(MAX_DURATION, Math.max(MIN_DURATION, n)) : DEFAULT_DURATION;
}

function newClip(from) {
    return { wf_type: from?.wf_type ?? WF_TYPES[0], duration: from?.duration ?? DEFAULT_DURATION, prompt_base: "", prompt_final: "" };
}

// the state of a clips_state value, repaired like parse_clips_state does in python
function parseState(value) {
    let raw;
    try { raw = typeof value === "string" ? JSON.parse(value || "{}") : value; } catch { raw = {}; }
    if (!raw || typeof raw !== "object") raw = {};
    const clips = (Array.isArray(raw.clips) ? raw.clips : [])
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
            wf_type: WF_TYPES.includes(c.wf_type) ? c.wf_type : WF_TYPES[0],
            duration: clampDuration(c.duration ?? DEFAULT_DURATION),
            prompt_base: String(c.prompt_base ?? ""),
            prompt_final: String(c.prompt_final ?? ""),
        }));
    if (!clips.length) clips.push(newClip());
    const active = Math.min(clips.length - 1, Math.max(0, Math.round(Number(raw.active)) || 0));
    return { active, clips };
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function makeScriptWidget(node, inputName, value) {
    injectCSS();
    let state = parseState(value);
    const textareas = {};

    const panel = el("div", { class: "nhs-panel" });
    // the canvas zooms on the wheel : kept for the textareas' own scroll
    panel.addEventListener("wheel", (ev) => { if (ev.target instanceof HTMLTextAreaElement) ev.stopPropagation(); });

    const changed = () => {
        node.setDirtyCanvas?.(true, true);
        app.graph?.change?.();
    };
    const clip = () => state.clips[state.active];

    // the tags go into prompt_base only, the one prompt the node parses
    function insertTag(tag) {
        const textarea = textareas.prompt_base;
        if (!textarea) return;
        const { value, caret } = spliceTag(textarea.value, textarea.selectionStart, textarea.selectionEnd, tag);
        textarea.value = value;
        clip().prompt_base = value;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        changed();
    }

    function select(index) {
        state.active = index;
        render();
        changed();
    }

    function addClip() {
        state.clips.push(newClip(clip()));
        select(state.clips.length - 1);
    }

    function removeClip() {
        if (state.clips.length < 2) return;
        const c = clip();
        if ((c.prompt_base.trim() || c.prompt_final.trim()) && !window.confirm(`Remove clip ${state.active + 1} and its prompts?`)) return;
        state.clips.splice(state.active, 1);
        select(Math.min(state.active, state.clips.length - 1));
    }

    function tabs() {
        return el("div", { class: "nhs-tabs" },
            state.clips.map((c, i) => el("button", { type: "button", class: i === state.active ? "active" : "",
                title: `Clip ${i + 1} : ${c.wf_type}, ${c.duration} s`,
                onclick: (ev) => { ev.stopPropagation(); if (i !== state.active) select(i); } }, String(i + 1))),
            el("span", { class: "nhs-sep" }),
            el("button", { type: "button", title: "Add a clip at the end (same workflow type and duration as the active one)",
                onclick: (ev) => { ev.stopPropagation(); addClip(); } }, "+"),
            el("button", { type: "button", title: "Remove the active clip", disabled: state.clips.length < 2,
                onclick: (ev) => { ev.stopPropagation(); removeClip(); } }, "−"));
    }

    function fields() {
        const c = clip();
        const wfType = el("select", { title: "The type of workflow of the clip",
            onchange: () => { c.wf_type = wfType.value; refreshTabs(); changed(); } },
            WF_TYPES.map((t) => el("option", { value: t, selected: t === c.wf_type }, t)));
        const duration = el("input", { type: "number", min: MIN_DURATION, max: MAX_DURATION, step: 1, value: c.duration,
            title: "The duration of the clip, in seconds",
            onchange: () => { c.duration = clampDuration(duration.value); duration.value = c.duration; refreshTabs(); changed(); } });
        const row = el("div", { class: "nhs-row" },
            el("label", {}, `clip ${state.active + 1}  wf_type`), wfType,
            el("label", {}, "duration (s)"), duration);

        const buttons = el("div", { class: "nhs-tagbtns" },
            BUTTONS.map((spec) => el("button", { type: "button",
                title: `Insert the @tag of a ${spec.slot} slot of the Media Loader in prompt_base`,
                // kept from taking the focus, so that prompt_base keeps its selection
                onpointerdown: (ev) => ev.preventDefault(),
                onclick: (ev) => { ev.stopPropagation(); openTagMenu(node, spec, insertTag); } }, spec.label)));

        const prompts = PROMPTS.flatMap((name) => {
            const label = el("div", { class: "nhs-label" },
                name === "prompt_base" ? "prompt_base (short, @tags parsed)" : "prompt_final (optional, not parsed)");
            const textarea = el("textarea", { class: name === "prompt_final" ? "final" : "", value: c[name],
                placeholder: name, spellcheck: false,
                oninput: () => { c[name] = textarea.value; },
                onchange: changed });
            textareas[name] = textarea;
            return [label, textarea];
        });
        return [row, buttons, ...prompts];
    }

    // the tab titles follow the fields of their clip
    function refreshTabs() {
        panel.firstChild?.replaceWith(tabs());
    }

    function render() {
        panel.replaceChildren(tabs(), ...fields());
    }

    const widget = node.addDOMWidget(inputName, WIDGET_TYPE, panel, {
        getValue() { return JSON.stringify(state); },
        setValue(v) { state = parseState(v); render(); },
        getMinHeight: () => PANEL_MIN_HEIGHT,
    });
    widget.__isH3ScriptUI = true;

    render();
    return widget;
}

// ── UI rebuild ────────────────────────────────────────────────────────────────
// If the node is re-created from the unpatched Python definition, clips_state
// shows up as a raw-JSON STRING widget — replace it with the panel, preserving
// the value (same recovery strategy as the Media Loader).

function isNodeAlive(node) {
    return !!node?.graph && node.graph.getNodeById(node.id) === node;
}

function rebuildScriptUI(node, force = false) {
    if (!node.widgets || !isNodeAlive(node)) return;
    const idx = node.widgets.findIndex((w) => w.name === WIDGET_NAME);
    if (idx === -1) return;
    const old = node.widgets[idx];
    if (!force && old.__isH3ScriptUI) return;

    let value = old.value ?? "{}";
    if (typeof value !== "string") {
        try { value = JSON.stringify(value); } catch { value = "{}"; }
    }
    try { old.onRemove?.(); } catch { /* ignore */ }
    old.element?.remove?.();
    node.widgets.splice(idx, 1);

    // addDOMWidget appends at the end : moved back to the original place, the
    // order of widgets_values
    const widget = makeScriptWidget(node, WIDGET_NAME, value);
    const newIdx = node.widgets.indexOf(widget);
    if (newIdx !== -1 && newIdx !== idx) {
        node.widgets.splice(newIdx, 1);
        node.widgets.splice(idx, 0, widget);
    }
}

function fitNode(node) {
    const min = node.computeSize();
    node.setSize([Math.max(NODE_MIN_WIDTH, node.size[0]), Math.max(min[1], node.size[1])]);
}

// ── Upstream nodes ────────────────────────────────────────────────────────────

const RESOLUTION_NODE_ID = ADDON_PREFIX + "ImageResolution";
const PIPE_NODE_ID = ADDON_PREFIX + "PipeCustom";
const LORA_STACK_NODE_ID = ADDON_PREFIX + "LoraStack";
const LORA_STACK_INPUTS = ["stack1", "stack2", "stack3"];
const UPSTREAM_GAP = 60;

function inputSlot(node, name) {
    return node.inputs?.findIndex((i) => i.name === name) ?? -1;
}

function isLinked(node, name) {
    const slot = inputSlot(node, name);
    return slot >= 0 && node.inputs[slot].link != null;
}

// a new node of a type added to the graph (placed later by placeRow), or null
function addNode(graph, type) {
    const node = LiteGraph.createNode(type);
    if (!node) return null;
    graph.add(node);
    return node;
}

// the box a node takes on the canvas, title bar included : [left, top, right, bottom]
function nodeBox(node) {
    const title = LiteGraph.NODE_TITLE_HEIGHT ?? 30;
    return [node.pos[0], node.pos[1] - title, node.pos[0] + node.size[0], node.pos[1] + node.size[1]];
}

// lay out a row of new nodes, the first one's right edge at right and the next ones on its
// left, at the first height from y where the row overlaps none of the other nodes of the graph ;
// the height below the row is returned
function placeRow(graph, row, right, y) {
    const title = LiteGraph.NODE_TITLE_HEIGHT ?? 30;
    const width = row.reduce((sum, n) => sum + n.size[0], 0) + UPSTREAM_GAP * (row.length - 1);
    const height = Math.max(...row.map((n) => n.size[1]));
    const others = graph._nodes.filter((n) => !row.includes(n)).map(nodeBox);
    for (let moved = true; moved; ) {
        moved = false;
        for (const [l, t, r, b] of others) {
            if (right - width < r && right > l && y - title < b && y + height > t) {
                y = b + UPSTREAM_GAP + title;
                moved = true;
            }
        }
    }
    let x = right;
    for (const n of row) {
        n.pos = [x - n.size[0], y];
        x -= n.size[0] + UPSTREAM_GAP;
    }
    return y + height + UPSTREAM_GAP + title;
}

// set the int widget of a node named name (or ending in ".name", the inputs of a dynamic combo)
function setWidget(node, name, value) {
    const widget = node.widgets?.find((w) => w.name === name || w.name?.endsWith("." + name));
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value);
}

// the Media Loader, Image Resolution and Pipe Custom + Lora Stack of the inputs not linked, laid
// out in a column on the left of the node, clear of the nodes already there
function createUpstreamNodes(node) {
    const graph = node.graph;
    if (!graph) return;
    const right = node.pos[0] - UPSTREAM_GAP;
    let y = node.pos[1];
    const created = [];

    graph.beforeChange?.();
    try {
        if (!isLinked(node, "media")) {
            const loader = addNode(graph, LOADER_NODE_ID);
            if (loader) {
                y = placeRow(graph, [loader], right, y);
                loader.connect(0, node, inputSlot(node, "media"));
                created.push("Media Loader");
            }
        }

        if (!isLinked(node, "width") && !isLinked(node, "height")) {
            const resolution = addNode(graph, RESOLUTION_NODE_ID);
            if (resolution) {
                // starting from the size set on the node
                setWidget(resolution, "width", node.widgets?.find((w) => w.name === "width")?.value);
                setWidget(resolution, "height", node.widgets?.find((w) => w.name === "height")?.value);
                y = placeRow(graph, [resolution], right, y);
                resolution.connect(0, node, inputSlot(node, "width"));
                resolution.connect(1, node, inputSlot(node, "height"));
                created.push("Image Resolution");
            }
        }

        if (!isLinked(node, "lora_stacks")) {
            const pipe = addNode(graph, PIPE_NODE_ID);
            if (pipe) {
                setPipeInputs(pipe, LORA_STACK_INPUTS.map((name) => ({ name, type: "LORA_STACK" })));
                // sized to its slots now, for the layout (setPipeInputs does it on the next frame)
                pipe.setSize([pipe.size[0], pipe.computeSize()[1]]);
                const stack = addNode(graph, LORA_STACK_NODE_ID);
                y = placeRow(graph, stack ? [pipe, stack] : [pipe], right, y);
                pipe.connect(0, node, inputSlot(node, "lora_stacks"));
                created.push("Pipe Custom");
                if (stack) {
                    stack.connect(0, pipe, inputSlot(pipe, LORA_STACK_INPUTS[0]));
                    created.push("Lora Stack");
                }
            }
        }
    } finally {
        graph.afterChange?.();
    }

    graph.setDirtyCanvas?.(true, true);
    if (created.length) toast("success", "Upstream nodes created", created.join(", "));
    else toast("info", "Nothing to create", "media, width / height and lora_stacks are all linked already.");
}

// RMB entries of the node, grouped into the addon submenu
registerNodeMenu((node) => {
    if (node?.comfyClass !== NODE_ID) return [];
    return [{
        content: "Create upstream nodes",
        callback: () => createUpstreamNodes(node),
    }];
});

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".media_h3_script",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_ID || !nodeData.input) return;
        for (const group of ["required", "optional"]) {
            const spec = nodeData.input[group]?.[WIDGET_NAME];
            if (spec) nodeData.input[group][WIDGET_NAME] = [WIDGET_TYPE, { ...(spec[1] ?? {}), default: "{}" }];
        }
    },

    getCustomWidgets() {
        return {
            [WIDGET_TYPE](node, inputName, inputData) {
                return { widget: makeScriptWidget(node, inputName, inputData[1]?.default ?? "{}") };
            },
        };
    },

    nodeCreated(node) {
        if (node.comfyClass !== NODE_ID) return;
        rebuildScriptUI(node);
        fitNode(node);
    },

    loadedGraphNode(node) {
        if (node.comfyClass !== NODE_ID) return;
        rebuildScriptUI(node);
        setTimeout(() => {
            if (!isNodeAlive(node)) return;
            const w = node.widgets?.find((x) => x.name === WIDGET_NAME);
            if (w?.__isH3ScriptUI && !w.element?.isConnected) rebuildScriptUI(node, true);
        }, 250);
    },
});
