// CREATED WITH CLAUDE
//
// "Picture", "Video" and "Audio" buttons of the Media Parser and Media Select By
// Tag nodes (py/media_loader.py, classes MediaParser and MediaSelectByTag), on
// one row above the prompt (a DOM widget, drawn by both the canvas and the Vue
// node renderers).
//
// Each button opens a list of the tags of the slots of its kind of the Media
// Loader feeding the node's media input : only the tagged slots that are
// switched on are listed, read from the loader's media_state when the button is pressed (so
// the list follows the loader without running the workflow). The loader is
// looked up directly upstream, through Reroute nodes (the core one and this
// addon's) but no other node ; native reroute points need nothing, a link keeps
// its origin node through them. Hovering a picture tag shows its picture, with
// the rotate / mirror / crop edits of the slot applied, in a floating thumbnail
// (videos and audios have no preview) ; clicking a tag inserts "@tag" in the prompt at the cursor (replacing the
// selection, if any), with a space added on either side where the tag would
// otherwise be glued to a word (TAG_REFERENCE in python : "x@tag" is not a
// reference and "@tagx" is the tag "tagx"). Escape or a click outside closes
// the list.

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { NODE_ID as LOADER_NODE_ID, parseState, viewURL, el, toast } from "./media_loader.js";
import { isEdited, paintEdited } from "./media_loader.editor.js";

const NODE_IDS = [ADDON_PREFIX + "MediaParser", ADDON_PREFIX + "MediaSelectByTag"];
const MEDIA_INPUT = "media";
const PROMPT_WIDGET = "prompt";
const LOADER_WIDGET = "media_state";
const BUTTONS_WIDGET = "tag_buttons";
const BUTTONS_HEIGHT = 24;

// the buttons, in their order on the row : the kind of slots each lists (a list of the
// loader's media_state), the slot name shown in the list, and whether a tag previews its media
export const BUTTONS = [
    { label: "Picture", kind: "pictures", slot: "picture", preview: true },
    { label: "Video",   kind: "videos",   slot: "video",   preview: false },
    { label: "Audio",   kind: "audios",   slot: "audio",   preview: false },
];

// the reroute nodes followed to reach the loader : the core frontend one and this addon's
const CORE_REROUTE = "Reroute";
const ADDON_REROUTE_PREFIX = ADDON_PREFIX + "Reroute";
const MAX_REROUTE_HOPS = 32;

const THUMB_SIZE = 256;
// a character a tag is made of (TAG_PATTERN in python) : "@" glued after one is not a reference,
// and one glued after the tag extends it
const TAG_CHAR = /[A-Za-z0-9_-]/;

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.ntp-menu {
    position: fixed;
    z-index: 10050;
    min-width: 140px;
    max-width: 280px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px;
    box-sizing: border-box;
    background: #191c22;
    border: 1px solid #303642;
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
    font-family: sans-serif;
    font-size: 12px;
    color: #c8cfda;
}
.ntp-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
}
.ntp-row:hover { background: #2a303b; color: #fff; }
.ntp-row .ntp-tag { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ntp-row .ntp-slot { font-size: 10px; color: #6b7484; }
.ntp-thumb {
    position: fixed;
    z-index: 10051;
    padding: 4px;
    background: #191c22;
    border: 1px solid #303642;
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
    pointer-events: none;
    line-height: 0;
}
.ntp-thumb img, .ntp-thumb canvas { max-width: ${THUMB_SIZE}px; max-height: ${THUMB_SIZE}px; border-radius: 3px; }
.ntp-buttons {
    display: flex;
    gap: 4px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
}
.ntp-buttons button {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--border-color, #3a4150);
    border-radius: 6px;
    background: var(--comfy-input-bg, #1e232c);
    color: var(--input-text, #c8cfda);
    font-size: 12px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ntp-buttons button:hover { filter: brightness(1.3); }
`;

let cssInjected = false;
function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
}

// the last pointer down, where the list opens (the button callback gets no usable event in
// every renderer)
let lastPointer = { x: 120, y: 120 };
window.addEventListener("pointerdown", (ev) => { lastPointer = { x: ev.clientX, y: ev.clientY }; }, true);

// ── Upstream loader ───────────────────────────────────────────────────────────

function isReroute(node) {
    const type = node?.comfyClass ?? node?.type;
    return type === CORE_REROUTE || (typeof type === "string" && type.startsWith(ADDON_REROUTE_PREFIX));
}

// the Media Loader feeding the node's media input, through reroute nodes only, or null
function upstreamLoader(node) {
    let slot = node.inputs?.findIndex((i) => i.name === MEDIA_INPUT) ?? -1;
    let current = node;
    for (let hops = 0; slot >= 0 && hops < MAX_REROUTE_HOPS; hops++) {
        const source = current.getInputNode?.(slot);
        if (!source) return null;
        if (source.comfyClass === LOADER_NODE_ID) return source;
        if (!isReroute(source)) return null;
        current = source;
        slot = 0;
    }
    return null;
}

// the tagged slots of a kind of a loader that are switched on, as { tag, index, item }
function taggedSlots(loader, kind) {
    const widget = loader.widgets?.find((w) => w.name === LOADER_WIDGET);
    const state = parseState(widget?.value);
    return state[kind]
        .map((item, index) => ({ tag: item?.tag, index, item }))
        .filter((s) => s.item && s.tag && s.item.enabled !== false);
}

// ── Prompt insertion ──────────────────────────────────────────────────────────

// the textarea showing the prompt : the one the Vue node renders when Vue nodes are on, the
// widget's own element otherwise
function promptTextarea(node, widget) {
    const vue = document.querySelector(`[data-node-id="${node.id}"] textarea`);
    if (vue instanceof HTMLTextAreaElement) return vue;
    const own = widget?.element;
    return own instanceof HTMLTextAreaElement ? own : null;
}

// "@tag" put in a text over the range start..end, spaced off the words around it : the new text
// and the caret position after the tag
export function spliceTag(text, start, end, tag) {
    const before = start > 0 && TAG_CHAR.test(text[start - 1]) ? " " : "";
    const after = end < text.length && TAG_CHAR.test(text[end]) ? " " : "";
    const insert = `${before}@${tag}${after}`;
    return { value: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}

// insert "@tag" at the cursor of the prompt (over the selection), spaced off the words around it
function insertTag(node, tag) {
    const widget = node.widgets?.find((w) => w.name === PROMPT_WIDGET);
    if (!widget) return;
    const textarea = promptTextarea(node, widget);
    const text = textarea ? textarea.value : String(widget.value ?? "");
    const start = textarea ? textarea.selectionStart : text.length;
    const end = textarea ? textarea.selectionEnd : text.length;
    const { value, caret } = spliceTag(text, start, end, tag);

    widget.value = value;
    widget.callback?.(value);
    if (textarea) {
        // the Vue textarea follows the widget value store, the classic one is the widget's element
        if (textarea.value !== value) textarea.value = value;
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
    }
    node.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
}

// ── Tag list ──────────────────────────────────────────────────────────────────

let closeOpenMenu = null;

// the list of the tags of a kind (a button of BUTTONS) of the loader feeding the node, a click on a
// tag passing it to insert (by default : inserted in the node's prompt widget)
export function openTagMenu(node, button, insert = (tag) => insertTag(node, tag)) {
    closeOpenMenu?.();
    const loader = upstreamLoader(node);
    if (!loader) {
        toast("warn", "No Media Loader", "Connect the media input to a Media Loader (directly or through reroutes).");
        return;
    }
    const slots = taggedSlots(loader, button.kind);
    if (!slots.length) {
        toast("info", `No tagged ${button.slot}`, `The Media Loader has no tagged ${button.slot} slot switched on (tag the slots with their T button or Auto tags).`);
        return;
    }
    injectCSS();

    // the pictures loaded for the thumbnail, by slot, for the time the list is open
    const images = new Map();
    let thumb = null;
    let hovered = null;

    const hideThumb = () => { thumb?.remove(); thumb = null; hovered = null; };
    const placeThumb = (row) => {
        if (!thumb) return;
        const r = row.getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        const w = thumb.offsetWidth, h = thumb.offsetHeight;
        let x = m.right + 6;
        if (x + w > window.innerWidth - 4) x = Math.max(4, m.left - 6 - w);
        const y = Math.max(4, Math.min(r.top, window.innerHeight - h - 4));
        thumb.style.left = `${x}px`;
        thumb.style.top = `${y}px`;
    };
    const showThumb = (slot, row) => {
        hideThumb();
        if (!button.preview) return;
        hovered = slot;
        let img = images.get(slot.index);
        if (!img) {
            img = el("img", { alt: slot.item.name });
            img.src = viewURL(slot.item);
            images.set(slot.index, img);
        }
        thumb = el("div", { class: "ntp-thumb" });
        const fill = () => {
            if (hovered !== slot || !thumb) return;
            thumb.replaceChildren(isEdited(slot.item.edit) ? paintEdited(img, slot.item.edit, THUMB_SIZE) : img);
            placeThumb(row);
        };
        document.body.append(thumb);
        if (img.complete && img.naturalWidth) fill();
        else img.addEventListener("load", fill, { once: true });
    };

    const close = () => {
        hideThumb();
        menu.remove();
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("pointerdown", onOutside, true);
        closeOpenMenu = null;
    };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); close(); } };
    const onOutside = (ev) => { if (!menu.contains(ev.target)) close(); };

    const menu = el("div", { class: "ntp-menu" },
        slots.map((slot) => {
            const row = el("div", { class: "ntp-row", title: `${slot.item.name} — insert @${slot.tag} in the prompt`,
                onmouseenter: () => showThumb(slot, row),
                onmouseleave: () => { if (hovered === slot) hideThumb(); },
                onpointerdown: (ev) => { ev.stopPropagation(); ev.preventDefault(); },
                onclick: (ev) => { ev.stopPropagation(); close(); insert(slot.tag); } },
                el("span", { class: "ntp-tag" }, `@${slot.tag}`),
                el("span", { class: "ntp-slot" }, `${button.slot} ${slot.index + 1}`));
            return row;
        }));
    menu.addEventListener("wheel", (ev) => ev.stopPropagation());
    document.body.append(menu);

    // at the pointer, kept inside the window
    const { x, y } = lastPointer;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;

    // installed after the pointer down that opened the list has gone by
    setTimeout(() => {
        if (!menu.isConnected) return;
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("pointerdown", onOutside, true);
    }, 0);
    closeOpenMenu = close;
}

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".media_parser.tag_picker",

    nodeCreated(node) {
        if (!NODE_IDS.includes(node.comfyClass)) return;
        if (node.widgets?.some((w) => w.name === BUTTONS_WIDGET)) return;
        injectCSS();
        const height = node.size[1];

        const row = el("div", { class: "ntp-buttons" },
            BUTTONS.map((spec) => el("button", { type: "button", title: `Insert the @tag of a ${spec.slot} slot of the Media Loader`,
                onclick: (ev) => { ev.stopPropagation(); openTagMenu(node, spec); } }, spec.label)));
        // kept out of the saved widget values and of the prompt sent to the server
        const widget = node.addDOMWidget(BUTTONS_WIDGET, "ntx_tag_buttons", row, {
            serialize: false, hideOnZoom: false, margin: 4,
            getValue: () => "", setValue: () => {},
            getMinHeight: () => BUTTONS_HEIGHT, getMaxHeight: () => BUTTONS_HEIGHT,
        });
        widget.serialize = false;

        // shown above the prompt : moved before it in the widget list
        const widgets = node.widgets;
        widgets.splice(widgets.indexOf(widget), 1);
        const prompt = widgets.findIndex((w) => w.name === PROMPT_WIDGET);
        widgets.splice(prompt >= 0 ? prompt : widgets.length, 0, widget);

        // LGraphNode.serialize writes each value at its widget's index, leaving a hole for the
        // buttons, while configure reads the values back in order skipping them : without the
        // hole closed, the prompt would be restored from the buttons' empty place
        const onSerialize = node.onSerialize;
        node.onSerialize = function (o) {
            onSerialize?.apply(this, arguments);
            if (Array.isArray(o.widgets_values) && this.widgets) {
                o.widgets_values = this.widgets.flatMap((w, i) => (w.serialize === false ? [] : [o.widgets_values[i]]));
            }
        };

        // grown by the row of the buttons, so that the prompt keeps its height (a loaded node
        // gets its saved size back afterwards)
        const min = node.computeSize();
        node.setSize([Math.max(node.size[0], min[0]), Math.max(height + BUTTONS_HEIGHT + 8, min[1])]);
    },
});
