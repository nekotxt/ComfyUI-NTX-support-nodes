// CREATED WITH CLAUDE
//
// Clip panel of the Media H3 Script node (py/media_h3_script.py, class
// MediaH3Script).
//
// The python node holds a string widget, clips_state, a JSON object with the
// clips of the script and the index of the active one, each clip holding its
// versions and the index of its active version :
//   {"start_video": "", "guide_video": "", "active": 0, "clips": [{"active": 0, "versions": [
//       {"wf_type", "duration", "length", "context", "lora_stack", "noise_seed", "prompt_base", "prompt_final"}, ...]}, ...]}
// (a clip of the older format, the fields without versions, is read as its
// version 0). It is replaced on the node by a panel (a DOM widget keeping the
// JSON as its value) : start_video and guide_video, settings of the whole script
// (the tags of video slots of the Media Loader, each typed or picked with its
// Video button, the same list as the Video tag button), a row of tabs, one per clip numbered from 1, with "+"
// (add a clip after the last one, with a version 0 taking the workflow type and
// duration and length of the active version) and "−" (remove the active clip), a row of
// tabs for the versions of the active clip numbered from 0, with "+" (add a
// version after the last one, a copy of the active version) and "−" (remove
// the active version), then the fields of the active version of the active clip :
// wf_type, duration (seconds), length (frames), context, lora_stack, noise_seed (with a Random button, the same
// draw as the Random Seed node), the Picture / Video / Audio tag buttons,
// prompt_base and prompt_final. lora_stack names an entry of the lora_stacks
// pipe : typed, or picked by its button among the LORA_STACK inputs of the
// Pipe Custom directly linked to lora_stacks (the button does nothing while
// lora_stacks is not linked). The tag buttons are the Media Parser's (media_parser.tag_picker.js) :
// the chosen "@tag" always goes into prompt_base, at its cursor, prompt_final
// not being parsed by the node. The active tabs are the clip and version a run
// works on.
//
// The node's RMB menu has "Create upstream nodes" : a Media Loader on the media
// input, an Image Resolution on width and height, a Pipe Custom (inputs stack1,
// stack2, stack3 of LORA_STACK) fed by a Lora Stack on lora_stacks, each one
// only when its input is not linked yet (width and height : when neither is).

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { el, toast, confirmDialog, NODE_ID as LOADER_NODE_ID } from "./media_loader.js";
import { BUTTONS, openTagMenu, spliceTag } from "./media_parser.tag_picker.js";
import { setPipeInputs } from "./context.pipe_custom.js";
import { registerNodeMenu } from "./menu.js";
import { SEED_MAX, randomSeed } from "./seed.random_seed.js";

const NODE_ID = ADDON_PREFIX + "MediaH3Script";
const WIDGET_NAME = "clips_state";
const WIDGET_TYPE = "NTX_H3_CLIPS";
const NODE_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 460;

// python twins : WF_TYPES, DEFAULT_CLIP, MIN_DURATION, MAX_DURATION, DEFAULT_LENGTH, MIN_LENGTH, MAX_LENGTH, CONTEXTS
const WF_TYPES = ["T2VA", "I2VA", "L2VA", "FL2VA", "Ref2VA"];
const DEFAULT_DURATION = 5;
const MIN_DURATION = 0.01;
const MAX_DURATION = 600;
const DEFAULT_LENGTH = 124;
const MIN_LENGTH = 5;
const MAX_LENGTH = 14404;
const FPS = 24;
// "none" or "<N> video + <M> audio" : the node reads the lengths from the text
const CONTEXTS = ["none", "22 video + 24 audio", "39 video + 48 audio"];
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
.nhs-tabs.versions button.active { background: #3b7d5a; border-color: #4f9a72; }
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
.nhs-row input.nhs-stack, .nhs-row input.nhs-seed { flex: 1; width: auto; min-width: 0; padding: 0 6px; }
.nhs-row button {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--border-color, #3a4150);
    border-radius: 5px;
    background: var(--comfy-input-bg, #1e232c);
    color: var(--input-text, #c8cfda);
    font-size: 12px;
    cursor: pointer;
}
.nhs-row button:hover { filter: brightness(1.3); }
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

// a seed as the JS numbers hold it exactly, 0 when not a number
function clampSeed(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(SEED_MAX, Math.max(0, n)) : 0;
}

// a duration in seconds, rounded to 2 decimals
function clampDuration(value) {
    const n = Math.round(Number(value) * 100) / 100;
    return Number.isFinite(n) ? Math.min(MAX_DURATION, Math.max(MIN_DURATION, n)) : DEFAULT_DURATION;
}

function clampLength(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, n)) : DEFAULT_LENGTH;
}

// the length in frames of a duration : at least 5 frames, then whole steps of 17 frames
function lengthOfDuration(duration) {
    const frames = Math.max(5, Math.round(duration * FPS));
    return clampLength(5 + 17 * Math.ceil((frames - 5) / 17));
}

// a length typed by the user, rounded up to the next valid one : 5 + 17k frames
function snapLength(value) {
    const n = clampLength(value);
    return clampLength(5 + 17 * Math.ceil((n - 5) / 17));
}

// the duration of a length in frames
function durationOfLength(length) {
    return clampDuration(length / FPS);
}

// a new version, the workflow type, duration, length and context taken from another one
function newVersion(from) {
    return { wf_type: from?.wf_type ?? WF_TYPES[0], duration: from?.duration ?? DEFAULT_DURATION, length: from?.length ?? DEFAULT_LENGTH, context: from?.context ?? CONTEXTS[0], lora_stack: "", noise_seed: 0, prompt_base: "", prompt_final: "" };
}

function newClip(from) {
    return { active: 0, versions: [newVersion(from)] };
}

function parseVersion(v) {
    return {
        wf_type: WF_TYPES.includes(v.wf_type) ? v.wf_type : WF_TYPES[0],
        duration: clampDuration(v.duration ?? DEFAULT_DURATION),
        length: clampLength(v.length ?? DEFAULT_LENGTH),
        context: CONTEXTS.includes(v.context) ? v.context : CONTEXTS[0],
        lora_stack: String(v.lora_stack ?? ""),
        noise_seed: clampSeed(v.noise_seed ?? 0),
        prompt_base: String(v.prompt_base ?? ""),
        prompt_final: String(v.prompt_final ?? ""),
    };
}

// a clip of the older format, the fields without versions, becomes its version 0
function parseClip(c) {
    if (!Array.isArray(c.versions)) return { active: 0, versions: [parseVersion(c)] };
    const versions = c.versions.filter((v) => v && typeof v === "object").map(parseVersion);
    if (!versions.length) versions.push(newVersion());
    return { active: clampIndex(c.active, versions.length), versions };
}

function clampIndex(value, length) {
    return Math.min(length - 1, Math.max(0, Math.round(Number(value)) || 0));
}

function hasPrompts(version) {
    return !!(version.prompt_base.trim() || version.prompt_final.trim());
}

// the state of a clips_state value, repaired like parse_clips_state does in python
function parseState(value) {
    let raw;
    try { raw = typeof value === "string" ? JSON.parse(value || "{}") : value; } catch { raw = {}; }
    if (!raw || typeof raw !== "object") raw = {};
    const clips = (Array.isArray(raw.clips) ? raw.clips : []).filter((c) => c && typeof c === "object").map(parseClip);
    if (!clips.length) clips.push(newClip());
    return { start_video: String(raw.start_video ?? ""), guide_video: String(raw.guide_video ?? ""), active: clampIndex(raw.active, clips.length), clips };
}

// ── LoRA stack picker ─────────────────────────────────────────────────────────

const LORA_STACKS_INPUT = "lora_stacks";

// the names of the LORA_STACK inputs of the Pipe Custom directly linked to the node's lora_stacks,
// or null when lora_stacks is not linked (a string : why there is nothing to list)
function stackNames(node) {
    const slot = node.inputs?.findIndex((i) => i.name === LORA_STACKS_INPUT) ?? -1;
    if (slot < 0 || node.inputs[slot].link == null) return null;
    const source = node.getInputNode?.(slot);
    if (source?.comfyClass !== PIPE_NODE_ID) return "lora_stacks is not linked directly to a Pipe Custom node.";
    const names = (source.inputs ?? []).filter((i) => i.type === "LORA_STACK").map((i) => i.name);
    return names.length ? names : "The Pipe Custom linked to lora_stacks has no LORA_STACK input.";
}

// the list of the LORA_STACK inputs, a click passing the chosen name to pick
function openStackMenu(node, event, pick) {
    const names = stackNames(node);
    if (names === null) return;
    if (typeof names === "string") {
        toast("info", "No LoRA stack to pick", names);
        return;
    }
    new LiteGraph.ContextMenu(names.map((name) => ({ content: name, callback: () => pick(name) })), {
        event,
        title: "lora_stack",
        className: "dark",
        scale: Math.max(1, app.canvas?.ds?.scale ?? 1),
    });
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
    const version = () => clip().versions[clip().active];

    // the tags go into prompt_base only, the one prompt the node parses
    function insertTag(tag) {
        const textarea = textareas.prompt_base;
        if (!textarea) return;
        const { value, caret } = spliceTag(textarea.value, textarea.selectionStart, textarea.selectionEnd, tag);
        textarea.value = value;
        version().prompt_base = value;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
        changed();
    }

    function select(index) {
        state.active = index;
        render();
        changed();
    }

    function selectVersion(index) {
        clip().active = index;
        render();
        changed();
    }

    function addClip() {
        state.clips.push(newClip(version()));
        select(state.clips.length - 1);
    }

    function addVersion() {
        const c = clip();
        c.versions.push({ ...version() });
        selectVersion(c.versions.length - 1);
    }

    // through the frontend's dialog : the native confirm() is silently refused in some browsers
    async function removeClip() {
        if (state.clips.length < 2) return;
        const index = state.active;
        const c = state.clips[index];
        if (c.versions.some(hasPrompts)) {
            if (!(await confirmDialog("Remove clip", `Remove clip ${index + 1}, its versions and their prompts?`))) return;
            if (state.clips[index] !== c) return;       // the clips changed meanwhile
        }
        state.clips.splice(index, 1);
        select(Math.min(index, state.clips.length - 1));
    }

    async function removeVersion() {
        const c = clip();
        if (c.versions.length < 2) return;
        const index = c.active;
        const v = c.versions[index];
        if (hasPrompts(v)) {
            if (!(await confirmDialog("Remove version", `Remove version ${index} of clip ${state.active + 1} and its prompts?`))) return;
            if (clip() !== c || c.versions[index] !== v) return;       // the clips changed meanwhile
        }
        c.versions.splice(index, 1);
        selectVersion(Math.min(index, c.versions.length - 1));
    }

    // a row of tabs : one per item, then the add and remove buttons
    function tabRow({ items, active, cls, label, title, onSelect, onAdd, onRemove, addTitle, removeTitle }) {
        return el("div", { class: "nhs-tabs" + (cls ? " " + cls : "") },
            items.map((item, i) => el("button", { type: "button", class: i === active ? "active" : "", title: title(item, i),
                onclick: (ev) => { ev.stopPropagation(); if (i !== active) onSelect(i); } }, label(i))),
            el("span", { class: "nhs-sep" }),
            el("button", { type: "button", title: addTitle, onclick: (ev) => { ev.stopPropagation(); onAdd(); } }, "+"),
            el("button", { type: "button", title: removeTitle, disabled: items.length < 2,
                onclick: (ev) => { ev.stopPropagation(); void onRemove(); } }, "−"));
    }

    function tabs() {
        return tabRow({
            items: state.clips, active: state.active,
            label: (i) => String(i + 1),
            title: (c, i) => { const v = c.versions[c.active]; return `Clip ${i + 1}, version ${c.active} : ${v.wf_type}, ${v.duration} s`; },
            onSelect: select, onAdd: addClip, onRemove: removeClip,
            addTitle: "Add a clip at the end (same workflow type, duration, length and context as the active version)",
            removeTitle: "Remove the active clip",
        });
    }

    function versionTabs() {
        const c = clip();
        return tabRow({
            items: c.versions, active: c.active, cls: "versions",
            label: (i) => String(i),
            title: (v, i) => `Version ${i} : ${v.wf_type}, ${v.duration} s`,
            onSelect: selectVersion, onAdd: addVersion, onRemove: removeVersion,
            addTitle: "Add a version at the end, a copy of the active one",
            removeTitle: "Remove the active version",
        });
    }

    function fields() {
        const c = version();
        const wfType = el("select", { title: "The type of workflow of the clip",
            onchange: () => { c.wf_type = wfType.value; refreshTabs(); changed(); } },
            WF_TYPES.map((t) => el("option", { value: t, selected: t === c.wf_type }, t)));
        // duration and length follow each other : the one the user changes sets the other
        const duration = el("input", { type: "number", min: MIN_DURATION, max: MAX_DURATION, step: 0.01, value: c.duration,
            title: "The duration of the clip, in seconds (sets the length)",
            onchange: () => {
                c.duration = clampDuration(duration.value);
                c.length = lengthOfDuration(c.duration);
                duration.value = c.duration; length.value = c.length; refreshTabs(); changed();
            } });
        const length = el("input", { type: "number", min: MIN_LENGTH, max: MAX_LENGTH, step: 17, value: c.length,
            title: "The length of the clip, in frames : 5 + 17k, rounded up to the next valid value (sets the duration)",
            onchange: () => {
                c.length = snapLength(length.value);
                c.duration = durationOfLength(c.length);
                duration.value = c.duration; length.value = c.length; refreshTabs(); changed();
            } });
        const row = el("div", { class: "nhs-row" },
            el("label", {}, `clip ${state.active + 1} v${clip().active}  wf_type`), wfType,
            el("label", {}, "duration (s)"), duration,
            el("label", {}, "length"), length);

        const stack = el("input", { type: "text", class: "nhs-stack", value: c.lora_stack, placeholder: "none",
            spellcheck: false, title: "The entry of the lora_stacks pipe used by the clip (empty : none)",
            oninput: () => { c.lora_stack = stack.value; },
            onchange: changed });
        const pick = el("button", { type: "button", title: "Pick a LORA_STACK input of the Pipe Custom linked to lora_stacks",
            onclick: (ev) => {
                ev.stopPropagation();
                openStackMenu(node, ev, (name) => { stack.value = name; c.lora_stack = name; changed(); });
            } }, "▾");
        const context = el("select", { title: "The motion context the clip continues with, in video + audio frames",
            onchange: () => { c.context = context.value; changed(); } },
            CONTEXTS.map((t) => el("option", { value: t, selected: t === c.context }, t)));
        const stackRow = el("div", { class: "nhs-row" }, el("label", {}, "context"), context,
            el("label", {}, "lora_stack"), stack, pick);

        const seed = el("input", { type: "number", class: "nhs-seed", min: 0, max: SEED_MAX, step: 1, value: c.noise_seed,
            title: "The noise seed of the clip",
            onchange: () => { c.noise_seed = clampSeed(seed.value); seed.value = c.noise_seed; changed(); } });
        const random = el("button", { type: "button", title: "Draw a new random seed",
            onclick: (ev) => { ev.stopPropagation(); c.noise_seed = randomSeed(); seed.value = c.noise_seed; changed(); } }, "Random");
        const seedRow = el("div", { class: "nhs-row" }, el("label", {}, "noise_seed"), seed, random);

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
        return [row, stackRow, seedRow, buttons, ...prompts];
    }

    // a video tag of the script (start_video, guide_video) : typed, or picked among the video tags of the loader
    function videoRow(field, title) {
        const input = el("input", { type: "text", class: "nhs-stack", value: state[field], placeholder: "none",
            spellcheck: false, title,
            oninput: () => { state[field] = input.value; },
            onchange: changed });
        const video = BUTTONS.find((spec) => spec.kind === "videos");
        const pick = el("button", { type: "button", title: "Pick the tag of a video slot of the Media Loader",
            onclick: (ev) => {
                ev.stopPropagation();
                openTagMenu(node, video, (tag) => { input.value = tag; state[field] = tag; changed(); });
            } }, video.label);
        return el("div", { class: "nhs-row" }, el("label", {}, field), input, pick);
    }

    // the tab rows, kept to be replaced when their titles change
    let clipRow = null, versionRow = null;

    // the tab titles follow the fields of their clip and version
    function refreshTabs() {
        const rows = [tabs(), versionTabs()];
        clipRow?.replaceWith(rows[0]);
        versionRow?.replaceWith(rows[1]);
        [clipRow, versionRow] = rows;
    }

    function render() {
        clipRow = tabs();
        versionRow = versionTabs();
        panel.replaceChildren(
            videoRow("start_video", "The tag of the video the first clip continues (empty : none)\nUse the 'context' setting to specify the number of frames to be used for the continuation.\n\nThe video will be stored in the pipe output (for the first clip only) as context_frames + context_audio."),
            videoRow("guide_video", "The tag of the video whose frames guide every clip (empty : none)\nThe node takes into account the 'context' video setting.\nSo for a 124 frames clip with 22 frames context only 102 frames of the guide are used.\nIf a 'context' is present for the clip, the guide is applied after those frames.\nFor multiple clips, the guide is split between clips taking into account their length and context.\nIf there are not enough frames for a clip, the last available frame is duplicated.\n\nExample:\n- the video guide is 300 frames\n- clip 1 is 124 frames, no context: 124 frames are applied starting from frame 0 of the clip, 176 passed on\n- clip 2 is 141 frames, 22 context: 119 frames are applied starting from frame 22 of the clip, 57 passed on\n- clip 3 is 124 frames, 22 context: 102 frames (57 from guide + 45 duplicated from the last frame) are applied starting from frame 22 of the clip\n\nThe frames relevant for the active clip will be stored in the pipe output as guide_main_frames, and the context start (if any) will be stored as guide_main_idx"),
            clipRow, versionRow, ...fields());
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
