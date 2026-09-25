// CREATED WITH CLAUDE
//
// Slot panel of the Media Loader node (py/media_loader.py, class MediaLoader).
//
// The python node holds a single string widget, media_state, a JSON object with
// the number of slot rows and one list per media kind (pictures / videos /
// audios), each list as long as the kind's slot count, an empty slot being null
// and a filled one
//   { name: "clip.mp4", file: "ntx_media/clip.mp4", type: "input" }
// where file is the path relative to the ComfyUI folder named by type, and name
// the original file name shown in the slot.
//
// This module swaps that string widget for a DOM panel drawing the slots: a
// grid of picture slots on the left (3 per row), the video and audio slots
// stacked on the right (1 of each per row). The number of rows is edited with
// the "Add slots" / "Remove slots" buttons. A slot is filled by dropping files
// on it or by picking them in the file dialog it opens when clicked; extra
// files spill over into the next free slots of the same kind. A loaded file is
// moved to another slot of its kind by holding the grip at the right of its
// slot and dragging (swapping with the file already there, if any). A picture
// opens at full size in a lightbox from its magnifier, and in the editor of
// media_loader.editor.js from its pencil ; a video and an audio open in the
// editors of media_loader.video_editor.js and media_loader.audio_editor.js from
// theirs. The editors record rotate / mirror / crop / max size / time range
// settings on the item (`edit`, see those modules), the file itself is never
// touched. Every filled slot also has an on / off toggle : a slot switched off
// carries `enabled: false` (the key is dropped when it is switched back on) and
// is greyed out ; the loader still outputs it, flagged, and the Media Splitter
// treats it as an empty slot. Files are uploaded through the core /upload/image
// route, in the input/ntx_media subfolder, and previewed straight from /view.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";
import { openEditor, isEdited, describeEdit, paintEdited, outputSize, ASPECTS } from "./media_loader.editor.js";
import { openVideoEditor, isVideoEdited, describeVideoEdit, normalizeVideoEdit } from "./media_loader.video_editor.js";
import { openAudioEditor, isAudioEdited, describeAudioEdit, normalizeAudioEdit } from "./media_loader.audio_editor.js";

const NODE_ID = ADDON_PREFIX + "MediaLoader";
const WIDGET_NAME = "media_state";
const WIDGET_TYPE = "NTX_MEDIA_SLOTS";

// where uploads go, relative to the ComfyUI input directory (MEDIA_SUBFOLDER in python)
const MEDIA_SUBFOLDER = "ntx_media";

// the slot layout: slots of each kind per row (SLOTS_PER_ROW in python) and the default row count
const KINDS = {
    pictures: { perRow: 3, label: "picture", accept: "image/*", css: "pic" },
    videos:   { perRow: 1, label: "video",   accept: "video/*", css: "vid" },
    audios:   { perRow: 1, label: "audio",   accept: "audio/*", css: "aud" },
};
const DEFAULT_ROWS = 3;
const MIN_ROWS = 1;

// a picture pasted from the clipboard has no name of its own : it is stored under
// this one, continuing into "image (1).png", "image (2).png", ... like the core
// route does. The extension has to match the bytes, because kindOf() sorts a file
// by its extension and the slot preview is served by it.
const PASTED_STEM = "image";
const PASTED_EXTENSIONS = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
    "image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif",
};

// the extensions each kind accepts when files are dropped (the file dialog filters by mime type)
const EXTENSIONS = {
    pictures: /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i,
    videos:   /\.(mp4|mov|mkv|webm|avi|m4v|mpe?g)$/i,
    audios:   /\.(wav|mp3|flac|ogg|m4a|aac|opus)$/i,
};

const NODE_MIN_WIDTH = 520;
// panel height: the top bar and headers, plus one picture row (the right column
// holds two shorter rows, a video and an audio, in the same height)
const PANEL_BASE_HEIGHT = 48;
const PANEL_ROW_HEIGHT = 106;
function panelHeight(rows) { return PANEL_BASE_HEIGHT + rows * PANEL_ROW_HEIGHT; }

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.nml-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 6px 6px;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    font-family: sans-serif;
    font-size: 11px;
    color: #9aa3b2;
}
.nml-panel.drop { outline: 1px dashed #6f86b8; outline-offset: -2px; }

.nml-top { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.nml-top .nml-hint { flex: 1; min-width: 0; font-size: 10px; color: #6b7484; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nml-btn {
    border: 1px solid #3a4150;
    border-radius: 4px;
    background: #1e232c;
    color: #c8cfda;
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
}
.nml-btn:hover { background: #2a303b; border-color: #59637a; }
.nml-btn:disabled { opacity: .4; cursor: default; }
.nml-btn.danger:hover { background: #7a2e2e; border-color: #a04040; color: #fff; }

.nml-report-overlay {
    position: fixed;
    inset: 0;
    z-index: 10040;
    background: rgba(8, 10, 14, .78);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
    font-size: 11px;
    color: #c8cfda;
}
.nml-report {
    width: min(640px, 94vw);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    box-sizing: border-box;
    background: #191c22;
    border: 1px solid #303642;
    border-radius: 8px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, .55);
}
.nml-report h3 { margin: 0; font-size: 12px; font-weight: bold; }
.nml-report .nml-report-body { overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.nml-report h4 { margin: 0; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #6b7484; }
.nml-report h4.ok { color: #7ec87e; }
.nml-report h4.up { color: #7fb8d8; }
.nml-report h4.miss { color: #e08a8a; }
.nml-report ul { margin: 0; padding-left: 16px; }
.nml-report li { line-height: 1.5; }
.nml-report li span { color: #6b7484; }
.nml-paste-hint { font-size: 11px; line-height: 1.6; color: #b9c0cc; }
.nml-paste-catch {
    width: 100%; height: 52px; box-sizing: border-box; padding: 6px; resize: none;
    background: #1b1f27; color: #8d95a3; border: 1px dashed #59637a; border-radius: 4px;
    font: inherit; font-size: 11px;
}
.nml-paste-catch:focus { outline: none; border-color: #7fb8d8; }
.nml-report .nml-report-foot { display: flex; justify-content: flex-end; }

.nml-cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}
.nml-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; min-height: 0; }
.nml-col.right { gap: 4px; }

.nml-sec {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 10px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #6b7484;
    padding: 0 2px;
}
.nml-sec span { letter-spacing: 0; }

.nml-grid { flex: 1; min-height: 0; display: grid; gap: 4px; grid-auto-rows: 1fr; }
.nml-grid.pictures { grid-template-columns: repeat(3, 1fr); }

.nml-slot {
    position: relative;
    border: 1px dashed #2b313d;
    border-radius: 6px;
    background: #141820;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #4d5563;
    font-size: 10px;
    cursor: pointer;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    user-select: none;
}
.nml-slot:hover { border-color: #59637a; color: #8a93a3; }
.nml-slot.hot { border-color: #6f86b8; background: #1b2230; color: #9db4dc; }
.nml-slot.filled { border-style: solid; border-color: #2e3440; background: #0f1116; color: #c8cfda; }
.nml-slot.filled.pic { border-color: #6d5527; }
.nml-slot.filled.vid { border-color: #255c6b; }
.nml-slot.filled.aud { border-color: #4c3d6e; }
.nml-slot.busy { border-style: dotted; color: #8a93a3; cursor: progress; }

.nml-slot img, .nml-slot video, .nml-slot canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    background: #0a0c10;
}
.nml-slot.pic { container-type: inline-size; }
.nml-slot .nml-size {
    position: absolute;
    left: 0; right: 0; top: 0;
    padding: 2px 4px;
    background: rgba(8, 10, 14, .72);
    color: #c8cfda;
    font-family: ui-monospace, monospace;
    font-size: clamp(7px, 9cqw, 10px);      /* shrinks with the slot, the remove button overlays it on hover */
    letter-spacing: -.2px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
}
.nml-slot .nml-name {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    padding: 2px 18px 2px 5px;
    background: rgba(8, 10, 14, .72);
    color: #c8cfda;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
}
.nml-slot.pic .nml-name { padding-right: 74px; }   /* four icons at the right of a picture caption */
.nml-slot.vid .nml-name { padding-right: 56px; }   /* three icons at the right of a video caption */
.nml-slot .nml-remove {
    position: absolute;
    top: 2px; right: 2px;
    width: 16px; height: 16px;
    line-height: 15px;
    text-align: center;
    border-radius: 3px;
    background: rgba(8, 10, 14, .72);
    color: #c8cfda;
    font-size: 12px;
    cursor: pointer;
    opacity: 0;
    transition: opacity .12s;
}
.nml-slot:hover .nml-remove { opacity: 1; }
.nml-slot .nml-remove:hover { background: #7a2e2e; color: #fff; }
.nml-slot .nml-grip {
    position: absolute;
    bottom: 2px; right: 2px;
    width: 16px; height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 3px;
    background: rgba(8, 10, 14, .72);
    color: #c8cfda;
    font-size: 11px;
    cursor: grab;
    opacity: 0;
    transition: opacity .12s;
    touch-action: none;
}
.nml-slot:hover .nml-grip { opacity: 1; }
.nml-slot .nml-grip:hover { background: #2a303b; color: #fff; }
.nml-slot .nml-grip:active { cursor: grabbing; }
.nml-slot .nml-zoom, .nml-slot .nml-edit {
    position: absolute;
    bottom: 2px; right: 38px;
    width: 16px; height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 3px;
    background: rgba(8, 10, 14, .72);
    color: #c8cfda;
    font-size: 11px;
    cursor: pointer;
    opacity: 0;
    transition: opacity .12s;
}
.nml-slot .nml-edit { right: 20px; }
.nml-slot.vid .nml-edit { right: 20px; }
.nml-slot:hover .nml-zoom, .nml-slot:hover .nml-edit { opacity: 1; }
.nml-slot .nml-zoom:hover, .nml-slot .nml-edit:hover { background: #2a303b; color: #fff; }
.nml-slot .nml-edit.on { opacity: 1; color: #e0a94c; }
/* the on / off toggle, left of the magnifier (of the pencil for a video) ; always shown when off */
.nml-slot .nml-toggle {
    position: absolute;
    bottom: 2px; right: 56px;
    width: 16px; height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 3px;
    background: rgba(8, 10, 14, .72);
    color: #fff;
    font-size: 11px;
    cursor: pointer;
    opacity: 0;
    transition: opacity .12s;
}
.nml-slot.vid .nml-toggle { right: 38px; }
.nml-slot:hover .nml-toggle, .nml-slot.off .nml-toggle { opacity: 1; }
.nml-slot .nml-toggle:hover { background: #2a303b; }
/* a slot switched off : its preview greyed out */
.nml-slot.off img, .nml-slot.off video, .nml-slot.off canvas { filter: grayscale(1) brightness(.45); }
.nml-slot.off .nml-glyph, .nml-slot.off .nml-aname, .nml-slot.off audio { filter: grayscale(1); opacity: .4; }

.nml-light {
    position: fixed;
    inset: 0;
    z-index: 10040;
    background: rgba(8, 10, 14, .78);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
}
.nml-lightbox {
    max-width: 92vw;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: #191c22;
    border: 1px solid #303642;
    border-radius: 8px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, .55);
    cursor: default;
}
.nml-lightbox img {
    display: block;
    max-width: 90vw;
    max-height: 84vh;
    object-fit: contain;
    background: #0a0c10;
}
.nml-lightcap {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: sans-serif;
    font-size: 11px;
    color: #c8cfda;
}
.nml-lightcap .nml-lightdims { color: #6b7484; }
.nml-lightcap .nml-btn { margin-left: auto; }
.nml-slot.moving { opacity: .45; }
.nml-ghost {
    position: fixed;
    z-index: 10050;
    width: 72px; height: 72px;
    border: 1px solid #6f86b8;
    border-radius: 4px;
    background: #0a0c10;
    overflow: hidden;
    box-shadow: 0 4px 14px rgba(0, 0, 0, .5);
    pointer-events: none;
}
.nml-ghost img { width: 100%; height: 100%; object-fit: contain; }
.nml-ghost.label {
    width: auto; height: auto;
    max-width: 200px;
    padding: 4px 8px;
    font-size: 10px;
    color: #c8cfda;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
/* in the audio row the grip sits inline, after the player */
.nml-arow .nml-grip, .nml-arow .nml-edit, .nml-arow .nml-toggle { position: static; opacity: 1; flex-shrink: 0; }

.nml-arow {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 0 22px 0 6px;     /* room on the right for the remove button above the grip */
    box-sizing: border-box;
    min-width: 0;
}
.nml-arow .nml-glyph { color: #a48ad6; font-size: 15px; flex-shrink: 0; }
.nml-arow .nml-aname {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 10px;
}
.nml-arow audio { height: 24px; width: 40%; min-width: 110px; flex-shrink: 0; }
`;

let cssInjected = false;
function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "class") e.className = v;
        else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
        else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in e) { try { e[k] = v; } catch { e.setAttribute(k, v); } }
        else e.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
        if (c == null) continue;
        e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
}

// full size view of a picture, closed by a click outside, the Close button or Escape
function lightbox(item) {
    const img = el("img", { src: viewURL(item), alt: item.name });
    const dims = el("span", { class: "nml-lightdims" });
    img.addEventListener("load", () => { dims.textContent = `${img.naturalWidth} x ${img.naturalHeight}`; });
    const close = () => { overlay.remove(); window.removeEventListener("keydown", onKey); };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
    const overlay = el("div", { class: "nml-light", onclick: (ev) => { if (ev.target === overlay) close(); } },
        el("div", { class: "nml-lightbox" }, img,
            el("div", { class: "nml-lightcap" },
                el("span", {}, item.name), dims,
                el("button", { class: "nml-btn", onclick: close }, "Close"))));
    window.addEventListener("keydown", onKey);
    document.body.append(overlay);
    return overlay;
}

function toast(severity, summary, detail) {
    try {
        app.extensionManager?.toast?.add({ severity, summary, detail, life: 4000 });
    } catch {
        console.log(`[MediaLoader] ${summary}: ${detail}`);
    }
}

// the aspect ratio of a size, among the ones the crop menu offers : the exact one when there
// is one, the closest one marked as approximate when it is within 10 %, nothing otherwise
const ASPECT_TOLERANCE = 0.10;
function aspectLabel(width, height) {
    if (!(width > 0) || !(height > 0)) return "";
    let best = null;
    for (const aspect of ASPECTS) {
        if (aspect === "free") continue;
        const [a, b] = aspect.split(":").map(Number);
        if (width * b === height * a) return aspect;
        const deviation = Math.abs(width / height - a / b) / (a / b);
        if (!best || deviation < best.deviation) best = { aspect, deviation };
    }
    return best && best.deviation <= ASPECT_TOLERANCE ? `≈${best.aspect}` : "";
}

// the size overlay of a picture slot : the size of the edited picture and its aspect ratio
function sizeLabel(width, height, edit) {
    const [ow, oh] = outputSize(width, height, edit);
    const aspect = aspectLabel(ow, oh);
    return `${ow}×${oh}${aspect ? ` · ${aspect}` : ""}`;
}

// whether the file of a slot item is still on the server (a HEAD on the view route)
async function fileExists(item) {
    try {
        const resp = await api.fetchApi(viewURL(item), { method: "HEAD" });
        return resp.ok;
    } catch {
        return false;
    }
}

// the report of a "Load missing" pass : three lists and a Close button
function showReport(title, sections) {
    const close = () => { overlay.remove(); window.removeEventListener("keydown", onKey); };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
    const body = el("div", { class: "nml-report-body" });
    for (const { heading, css, items, empty } of sections) {
        body.append(el("h4", { class: css }, `${heading} (${items.length})`));
        body.append(items.length
            ? el("ul", {}, items.map(({ text, note }) => el("li", {}, text, note ? el("span", {}, ` \u2014 ${note}`) : null)))
            : el("div", { style: { color: "#6b7484", paddingLeft: "16px" } }, empty));
    }
    const overlay = el("div", { class: "nml-report-overlay", onclick: (ev) => { if (ev.target === overlay) close(); } },
        el("div", { class: "nml-report" },
            el("h3", {}, title),
            body,
            el("div", { class: "nml-report-foot" }, el("button", { class: "nml-btn", onclick: close }, "Close"))));
    window.addEventListener("keydown", onKey);
    document.body.append(overlay);
    return overlay;
}

// ask the user to confirm an action, through the frontend's dialog when it is there
async function confirmDialog(title, message) {
    const dialog = app.extensionManager?.dialog;
    if (typeof dialog?.confirm === "function") {
        return (await dialog.confirm({ title, message, type: "delete" })) === true;
    }
    return window.confirm(title + "\n\n" + message);
}

// an empty state: every slot of every kind free
function emptyState(rows = DEFAULT_ROWS) {
    const state = { rows };
    for (const [kind, spec] of Object.entries(KINDS)) state[kind] = new Array(rows * spec.perRow).fill(null);
    return state;
}

// parse the widget value, keeping the slot positions and normalising the lists to the slot counts
function parseState(value) {
    let raw = {};
    try {
        raw = typeof value === "string" ? JSON.parse(value || "{}") : (value ?? {});
    } catch { raw = {}; }
    if (!raw || typeof raw !== "object") raw = {};
    let rows = parseInt(raw.rows, 10);
    if (!Number.isFinite(rows)) rows = DEFAULT_ROWS;
    rows = Math.max(MIN_ROWS, rows);
    const state = emptyState(rows);
    for (const [kind, spec] of Object.entries(KINDS)) {
        const list = Array.isArray(raw[kind]) ? raw[kind] : [];
        for (let i = 0; i < rows * spec.perRow; i++) {
            const item = list[i];
            state[kind][i] = item && typeof item === "object" && item.file ? { ...item } : null;
        }
    }
    return state;
}

// the kind a dropped file belongs to, from its extension (null when unsupported)
function kindOf(file) {
    for (const [kind, re] of Object.entries(EXTENSIONS)) if (re.test(file.name)) return kind;
    return null;
}

// preview URL of a slot item, served by the core /view route
function viewURL(item) {
    const slash = item.file.lastIndexOf("/");
    const subfolder = slash >= 0 ? item.file.slice(0, slash) : "";
    const filename = slash >= 0 ? item.file.slice(slash + 1) : item.file;
    return api.apiURL(`/view?filename=${encodeURIComponent(filename)}`
        + `&subfolder=${encodeURIComponent(subfolder)}&type=${item.type || "input"}`
        + `&rand=${Math.random()}`);
}

// upload one file through the core route, into the loader's input subfolder
// ask the server to write the audio of a span of a video as a FLAC file in the loader's subfolder
// ask the server to copy the loaded files and a description of the slots into a new folder
async function exportMedia(mediaState) {
    const resp = await api.fetchApi(`/${API_PREFIX}/media_loader/export`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_state: mediaState }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `export failed (${resp.status})`);
    return data;
}

async function extractAudio(item, start, end) {
    const resp = await api.fetchApi(`/${API_PREFIX}/media_loader/extract_audio`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: item.file, type: item.type || "input", start, end }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `extraction failed (${resp.status})`);
    return { name: data.name, file: data.file, type: data.type || "input" };
}

async function uploadFile(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("subfolder", MEDIA_SUBFOLDER);
    body.append("type", "input");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!resp.ok) throw new Error(`upload failed (${resp.status})`);
    const data = await resp.json();
    const path = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
    return { name: file.name, file: path, type: data.type || "input" };
}

// Upload a picture coming from the clipboard, through the addon's own route
// (py/load_image.py) rather than the core one.
//
// Every clipboard image arrives named "image.png", so the core route would store
// them as the "image.png", "image (1).png", ... series and, before taking a name,
// re-read and re-hash every file of that series to avoid storing the same bytes
// twice. That check costs nothing today and turns into seconds once the folder
// holds a few hundred of them. The addon's route applies the very same rule from
// a hash register kept next to the images, so a file is hashed once in its
// lifetime. Dropped files and the file picker keep the core route: they carry
// their own names and never build such a series.
async function uploadPastedFile(file) {
    const body = new FormData();
    body.append("image", file, file.name);
    body.append("subfolder", MEDIA_SUBFOLDER);
    const resp = await api.fetchApi(`/${API_PREFIX}/load_image/upload_pasted`, { method: "POST", body });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `upload failed (${resp.status})`);
    const path = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
    return { name: data.name, file: path, type: data.type || "input" };
}

// a clipboard blob, as a File the slots can take : they sort a file by its
// extension, so the name has to carry the type
function pictureFile(blob) {
    const ext = PASTED_EXTENSIONS[blob.type] ?? ".png";
    return new File([blob], PASTED_STEM + ext, { type: blob.type });
}

// The picture sitting in the clipboard, as a File, or null when the clipboard
// holds no image. Throws when the clipboard cannot be read at all, which is a
// different thing from an empty one and is what askForPaste() answers.
async function clipboardPicture() {
    if (!navigator.clipboard?.read) {
        // the Clipboard API is only handed to secure contexts : ComfyUI reached
        // on http://127.0.0.1 is one, the same server reached over plain http
        // from another machine is not
        throw new Error("no Clipboard API on this page");
    }

    const items = await navigator.clipboard.read();
    for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        return pictureFile(await item.getType(type));
    }
    return null;
}

// Ask the user to paste, for the browsers that will not hand the clipboard over
// on their own.
//
// Reading the clipboard unprompted needs the "clipboard-read" permission, which
// plenty of setups simply refuse : an embedded browser with no permission UI to
// ask through, a browser whose clipboard setting is blocked, a page reached over
// plain http from another machine. A paste *event*, on the other hand, carries
// its data with no permission at all, anywhere - it is what the Load Image &
// Edit node has always used. So when the clipboard cannot be read, ask for the
// keystroke instead.
//
// Resolves with the pasted picture, or null when the user cancelled or pasted
// something that is not a picture.
function askForPaste() {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (file) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("keydown", onKey, true);
            overlay.remove();
            resolve(file);
        };
        const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(null); } };

        // a real textarea, not a contenteditable : the core paste handler steps
        // aside for textareas and inputs, so it will not act on this paste too
        // and drop a Load Image node on the canvas behind the dialog
        const catcher = el("textarea", { class: "nml-paste-catch", placeholder: "Ctrl+V here" });
        catcher.addEventListener("paste", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const items = [...(ev.clipboardData?.items ?? [])];
            const blob = items.find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
            finish(blob ? pictureFile(blob) : null);
            if (!blob) toast("warn", "Nothing pasted", "the clipboard holds no picture");
        });

        const overlay = el("div", {
            class: "nml-report-overlay",
            onclick: (ev) => { if (ev.target === overlay) finish(null); },
        }, el("div", { class: "nml-report" },
            el("h3", {}, "Paste a picture"),
            el("div", { class: "nml-paste-hint" },
                "This browser does not let the page read the clipboard on its own.",
                el("br"),
                "Press ", el("b", {}, "Ctrl+V"), " to paste a picture into the first free slot."),
            catcher,
            el("div", { class: "nml-report-foot" },
                el("button", { class: "nml-btn", onclick: () => finish(null) }, "Cancel"))));

        window.addEventListener("keydown", onKey, true);
        document.body.append(overlay);
        catcher.focus();
    });
}

// ── Widget ────────────────────────────────────────────────────────────────────

function makeMediaWidget(node, inputName, initialValue) {
    injectCSS();

    let state = parseState(initialValue);
    // slots with an upload in flight, as "kind:index" keys
    const busy = new Set();

    const panel = el("div", { class: "nml-panel" });

    // one hidden file input, re-targeted to the slot that opened it
    let pickTarget = null;
    const picker = el("input", { type: "file", multiple: true, style: { display: "none" } });
    picker.addEventListener("change", (ev) => {
        const files = [...ev.target.files];
        ev.target.value = "";
        if (pickTarget && files.length) addFiles(files, pickTarget.kind, pickTarget.index);
        pickTarget = null;
    });
    panel.append(picker);

    function openPicker(kind, index) {
        pickTarget = { kind, index };
        picker.accept = KINDS[kind].accept;
        picker.click();
    }

    // ── state ──
    function commit() {
        try { node.graph?.setDirtyCanvas(true, true); } catch { /* ignore */ }
        render();
    }

    function freeIndex(kind, from) {
        const list = state[kind];
        for (let i = from; i < list.length; i++) if (!list[i] && !busy.has(`${kind}:${i}`)) return i;
        return -1;
    }

    // load files starting at a given slot: the first file takes that slot (replacing whatever is
    // there), the others spill over into the next free slots of the same kind
    async function addFiles(files, kind, index, uploader = uploadFile) {
        let target = index;
        let first = true;
        const uploads = [];
        for (const file of files) {
            const fileKind = kindOf(file);
            if (!fileKind) {
                toast("warn", "Unsupported file", `${file.name} is not a picture, video or audio file`);
                continue;
            }
            if (!file.size) {
                toast("warn", "Empty file", `${file.name} is empty — skipped`);
                continue;
            }
            const useKind = kind ?? fileKind;
            if (fileKind !== useKind) {
                toast("warn", `Not a ${KINDS[useKind].label}`, `${file.name} skipped`);
                continue;
            }
            let slot;
            if (first && index != null && useKind === kind) {
                slot = index;                       // the slot the user aimed at, even if filled
            } else {
                slot = freeIndex(useKind, kind === useKind && target != null ? target : 0);
            }
            first = false;
            if (slot < 0) {
                toast("warn", "No free slot", `All ${state[useKind].length} ${KINDS[useKind].label} slots are full — ${file.name} skipped`);
                continue;
            }
            target = slot + 1;
            uploads.push(upload(file, useKind, slot, uploader));
        }
        await Promise.all(uploads);
    }

    async function upload(file, kind, index, uploader = uploadFile) {
        const key = `${kind}:${index}`;
        busy.add(key);
        render();
        try {
            state[kind][index] = await uploader(file);
        } catch (err) {
            toast("error", "Upload failed", `${file.name}: ${err.message}`);
        } finally {
            busy.delete(key);
            commit();
        }
    }

    // The "Paste picture from clipboard" entry of the node's right click menu: the
    // picture held by the clipboard lands in the first free picture slot. A
    // clipboard holding no picture is not an error and does nothing; a clipboard
    // that cannot be read at all is reported, as is a panel with no free slot -
    // that last one by addFiles, which already warns when every slot is taken.
    async function pasteFromClipboard() {
        let file;
        try {
            file = await clipboardPicture();
        } catch {
            // the browser refuses to hand the clipboard over : ask for the
            // keystroke instead, which needs no permission anywhere
            file = await askForPaste();
        }
        if (!file) return;

        await addFiles([file], "pictures", null, uploadPastedFile);
    }

    function remove(kind, index) {
        state[kind][index] = null;
        commit();
    }

    // switch a slot on or off : only the off state is recorded on the item
    function toggle(kind, index) {
        const live = state[kind][index];
        if (!live) return;
        if (live.enabled === false) delete live.enabled; else live.enabled = false;
        commit();
    }

    // move an item to another slot of the same kind, swapping with whatever is there
    function move(kind, from, to) {
        if (from === to || !state[kind][from]) return;
        [state[kind][from], state[kind][to]] = [state[kind][to], state[kind][from]];
        commit();
    }

    // ── slot to slot moves ──
    // Holding the grip of a filled slot starts a move : the pointer is captured
    // by the grip, a ghost thumbnail follows it, the slot under it (same kind
    // only) lights up, and releasing there moves the item. Pointer capture
    // keeps the events flowing even when the pointer leaves the node.
    function startMove(ev, grip, kind, index, item) {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        const source = grip.closest(".nml-slot");
        const thumb = source.querySelector("img");
        const ghost = thumb
            ? el("div", { class: "nml-ghost" }, el("img", { src: thumb.src }))
            : el("div", { class: "nml-ghost label" }, `${kind === "videos" ? "\u25b6" : "\u266a"} ${item.name}`);
        document.body.append(ghost);
        source.classList.add("moving");
        let target = null;

        const place = (e) => { ghost.style.left = `${e.clientX + 14}px`; ghost.style.top = `${e.clientY + 14}px`; };
        const slotAt = (e) => {
            const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".nml-slot");
            return slot && slot !== source && slot.dataset.kind === kind && panel.contains(slot) ? slot : null;
        };
        const onMove = (e) => {
            place(e);
            const slot = slotAt(e);
            if (slot === target) return;
            target?.classList.remove("hot");
            target = slot;
            target?.classList.add("hot");
        };
        const onUp = (e) => {
            grip.removeEventListener("pointermove", onMove);
            grip.removeEventListener("pointerup", onUp);
            grip.removeEventListener("pointercancel", onUp);
            try { grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
            ghost.remove();
            source.classList.remove("moving");
            target?.classList.remove("hot");
            if (e.type === "pointerup" && target) move(kind, index, parseInt(target.dataset.index, 10));
        };
        grip.addEventListener("pointermove", onMove);
        grip.addEventListener("pointerup", onUp);
        grip.addEventListener("pointercancel", onUp);
        try { grip.setPointerCapture(ev.pointerId); } catch { /* not a live pointer : events still reach the grip */ }
        place(ev);
    }

    function gripFor(kind, index, item) {
        const grip = el("div", { class: "nml-grip", title: "Hold and drag to move to another slot" }, "\u2630");
        grip.addEventListener("pointerdown", (ev) => startMove(ev, grip, kind, index, item));
        grip.addEventListener("click", (ev) => ev.stopPropagation());
        return grip;
    }

    // the on / off toggle of a filled slot : a full circle when on, an empty one when off
    function toggleFor(kind, index, item) {
        const on = item.enabled !== false;
        return el("div", { class: "nml-toggle",
            title: on ? "On : the Media Splitter outputs this slot — click to switch it off"
                      : "Off : the Media Splitter outputs None for this slot, as if it were empty — click to switch it on",
            onclick: (ev) => { ev.stopPropagation(); toggle(kind, index); } }, on ? "●" : "○");
    }

    function loadedCount() {
        return Object.keys(KINDS).reduce((n, kind) => n + state[kind].filter(Boolean).length, 0);
    }

    // snap the node height to the panel, once the rows changed
    function fitNode() {
        const min = node.computeSize();
        node.setSize([Math.max(NODE_MIN_WIDTH, node.size[0]), min[1]]);
    }

    // the first free slot of a kind, adding a row of slots when every one is taken
    function freeOrNewIndex(kind) {
        let index = freeIndex(kind, 0);
        if (index < 0) {
            addRow();
            index = freeIndex(kind, 0);
        }
        return index;
    }

    // the video editor's "Save frame" and "Save audio" : the frame is uploaded like a dropped
    // file, the audio is extracted by the server ; both land in the first free slot of their kind
    const editorActions = {
        async saveFrame(blob, name, edit) {
            const index = freeOrNewIndex("pictures");
            const file = new File([blob], name, { type: "image/png" });
            await upload(file, "pictures", index);
            const live = state.pictures[index];
            if (!live) throw new Error("the frame could not be uploaded");
            if (isEdited(edit)) { live.edit = edit; commit(); }
            return `frame saved as ${live.name}, in picture slot ${index + 1}`;
        },
        async saveAudio(item, start, end) {
            const index = freeOrNewIndex("audios");
            const key = `audios:${index}`;
            busy.add(key); render();
            try {
                state.audios[index] = await extractAudio(item, start, end);
            } finally {
                busy.delete(key); commit();
            }
            return `audio saved as ${state.audios[index].name}, in audio slot ${index + 1}`;
        },
    };

    // one more row: 3 picture slots, 1 video slot, 1 audio slot
    function addRow() {
        state.rows += 1;
        for (const [kind, spec] of Object.entries(KINDS)) {
            for (let i = 0; i < spec.perRow; i++) state[kind].push(null);
        }
        commit();
        fitNode();
    }

    // one row less, after confirmation when any of the slots going away is filled
    // (the files stay in the input folder)
    async function removeRow() {
        if (state.rows <= MIN_ROWS) return;
        const going = [];
        for (const [kind, spec] of Object.entries(KINDS)) {
            going.push(...state[kind].slice(-spec.perRow).filter(Boolean));
        }
        if (going.length) {
            const names = going.map(item => item.name).join(", ");
            const ok = await confirmDialog("Remove slots",
                `The last row holds ${going.length} loaded file${going.length > 1 ? "s" : ""} (${names}). `
                + "Remove the slots anyway ? The files stay in the input folder.");
            if (!ok) return;
        }
        state.rows -= 1;
        for (const [kind, spec] of Object.entries(KINDS)) state[kind].length -= spec.perRow;
        commit();
        fitNode();
    }

    // empty every slot, after confirmation (the files stay in the input folder)
    // ── load missing ──
    // Every filled slot is checked on the server ; the files gone missing (a workflow opened on
    // another machine, a cleaned input folder) are looked for, by name, in a folder the user
    // picks on this machine, and uploaded from there. The pass ends with a report.
    let loadingMissing = false;
    const folderPicker = el("input", { type: "file", multiple: true, style: { display: "none" } });
    folderPicker.webkitdirectory = true;

    function filledSlots() {
        const list = [];
        for (const kind of Object.keys(KINDS)) {
            state[kind].forEach((item, index) => { if (item) list.push({ kind, index, item }); });
        }
        return list;
    }

    // the file of the picked folder matching a slot item : by its original name first, then by
    // the name it is stored under, case-insensitively ; the shallowest match wins
    function matchFile(item, files) {
        const wanted = [item.name, item.file.slice(item.file.lastIndexOf("/") + 1)].map(n => n.toLowerCase());
        for (const name of wanted) {
            const found = files.filter(f => f.name.toLowerCase() === name)
                .sort((a, b) => (a.webkitRelativePath || "").split("/").length - (b.webkitRelativePath || "").split("/").length);
            if (found.length) return found[0];
        }
        return null;
    }

    // upload a file for a slot whose file is missing : the slot keeps its name and edits, and
    // points at the name the server stored the file under
    async function reupload(kind, index, file) {
        const key = `${kind}:${index}`;
        busy.add(key); render();
        try {
            const uploaded = await uploadFile(file);
            const live = state[kind][index];
            if (live) { live.file = uploaded.file; live.type = uploaded.type; }
        } finally {
            busy.delete(key); commit();
        }
    }

    // open the folder picker : the files of the chosen folder (subfolders included), or null
    // when the picker was cancelled
    function pickFolder() {
        return new Promise((resolve) => {
            let timer = 0;
            const done = (list) => {
                clearTimeout(timer);
                folderPicker.removeEventListener("change", onChange);
                folderPicker.removeEventListener("cancel", onCancel);
                window.removeEventListener("focus", onFocus);
                resolve(list);
            };
            const onChange = () => { const list = [...folderPicker.files]; folderPicker.value = ""; done(list); };
            const onCancel = () => done(null);
            // browsers without the cancel event : the window gets its focus back once the
            // dialog closes, and a selection follows within a moment when there is one
            const onFocus = () => { clearTimeout(timer); timer = setTimeout(() => done(null), 1000); };
            folderPicker.addEventListener("change", onChange);
            folderPicker.addEventListener("cancel", onCancel);
            setTimeout(() => window.addEventListener("focus", onFocus), 100);
            folderPicker.click();
        });
    }

    async function loadMissing() {
        if (loadingMissing) return;
        loadingMissing = true;
        render();
        try {
            const slots = filledSlots();
            const label = ({ kind, index, item }) => `${item.name} (${KINDS[kind].label} ${index + 1})`;
            const present = [], missing = [];
            for (const slot of slots) (await fileExists(slot.item) ? present : missing).push(slot);
            const found = present.map(s => ({ text: label(s) }));
            if (!missing.length) {
                showReport("Load missing media", [
                    { heading: "Found on the server, unchanged", css: "ok", items: found, empty: "no media loaded" },
                    { heading: "Missing, uploaded", css: "up", items: [], empty: "nothing was missing" },
                    { heading: "Still missing", css: "miss", items: [], empty: "none" },
                ]);
                return;
            }
            const files = await pickFolder();
            if (!files) return;                     // the picker was cancelled
            const uploaded = [], still = [];
            for (const slot of missing) {
                const file = matchFile(slot.item, files);
                if (!file) { still.push({ text: label(slot), note: "not in the folder" }); continue; }
                if (!file.size) { still.push({ text: label(slot), note: "the file in the folder is empty" }); continue; }
                try {
                    await reupload(slot.kind, slot.index, file);
                    const stored = state[slot.kind][slot.index]?.file ?? "";
                    uploaded.push({ text: label(slot), note: `from ${file.webkitRelativePath || file.name}`
                        + (stored.slice(stored.lastIndexOf("/") + 1) !== slot.item.name ? `, stored as ${stored.slice(stored.lastIndexOf("/") + 1)}` : "") });
                } catch (err) {
                    still.push({ text: label(slot), note: `upload failed : ${err.message}` });
                }
            }
            showReport("Load missing media", [
                { heading: "Found on the server, unchanged", css: "ok", items: found, empty: "none" },
                { heading: "Missing, uploaded from the folder", css: "up", items: uploaded, empty: "none" },
                { heading: "Still missing", css: "miss", items: still, empty: "none" },
            ]);
        } finally {
            loadingMissing = false;
            render();
        }
    }

    // ── import ──
    // The reverse of Export : a folder holding a media.json and the files it names is loaded
    // into the node, replacing its content ; the files are uploaded like dropped ones, so the
    // slots end up referencing the copies in input/ntx_media, not the picked folder.
    let importing = false;
    const IMPORT_JSON = "media.json";

    // the media.json of the picked files, with the folder it sits in as a prefix for its files
    async function readImportDescription(files) {
        const jsons = files.filter(f => f.name.toLowerCase() === IMPORT_JSON);
        if (!jsons.length) throw new Error(`the folder holds no ${IMPORT_JSON}`);
        if (jsons.length > 1) throw new Error(`the folder holds several ${IMPORT_JSON} (${jsons.map(f => f.webkitRelativePath).join(", ")}) : pick the folder of one export`);
        const json = jsons[0];
        const path = json.webkitRelativePath || json.name;
        const base = path.slice(0, path.length - json.name.length);        // "export/" or ""
        let description;
        try {
            description = JSON.parse(await json.text());
        } catch (err) {
            throw new Error(`${IMPORT_JSON} is not valid JSON : ${err.message}`);
        }
        if (!description || typeof description !== "object") throw new Error(`${IMPORT_JSON} does not describe a media set`);
        for (const kind of Object.keys(KINDS)) {
            if (description[kind] != null && !Array.isArray(description[kind])) throw new Error(`${IMPORT_JSON} : "${kind}" is not a list`);
            for (const entry of description[kind] ?? []) {
                if (!entry || typeof entry !== "object" || !Number.isInteger(entry.slot) || entry.slot < 0 || typeof entry.name !== "string" || !entry.name) {
                    throw new Error(`${IMPORT_JSON} : a ${KINDS[kind].label} entry lacks its slot or name`);
                }
            }
        }
        return { description, base };
    }

    async function importAll() {
        if (importing) return;
        const files = await pickFolder();
        if (!files) return;
        importing = true;
        render();
        try {
            let description, base;
            try {
                ({ description, base } = await readImportDescription(files));
            } catch (err) {
                toast("error", "Import failed", err.message);
                return;
            }
            // the node is replaced : ask first when something is loaded
            const count = loadedCount();
            if (count) {
                const ok = await confirmDialog("Import media",
                    `Replace the ${count} loaded file${count > 1 ? "s" : ""} of this node with the content of the folder ? The files stay in the input folder.`);
                if (!ok) return;
            }
            // as many rows as the description asks for, and at least as many as its slots need
            let rows = parseInt(description.rows, 10);
            if (!Number.isFinite(rows)) rows = MIN_ROWS;
            for (const [kind, spec] of Object.entries(KINDS)) {
                for (const entry of description[kind] ?? []) rows = Math.max(rows, Math.ceil((entry.slot + 1) / spec.perRow));
            }
            state = emptyState(Math.max(MIN_ROWS, rows));
            commit();
            fitNode();
            // upload every file of the description into its slot
            const byPath = new Map(files.map(f => [(f.webkitRelativePath || f.name).toLowerCase(), f]));
            let loaded = 0;
            const missing = [];
            for (const kind of Object.keys(KINDS)) {
                for (const entry of description[kind] ?? []) {
                    const label = `${entry.name} (${KINDS[kind].label} ${entry.slot + 1})`;
                    const file = byPath.get((base + entry.name).toLowerCase());
                    if (!file) { missing.push(`${label} : not in the folder`); continue; }
                    if (!file.size) { missing.push(`${label} : empty file`); continue; }
                    if (!kindOf(file) || kindOf(file) !== kind) { missing.push(`${label} : not a ${KINDS[kind].label} file`); continue; }
                    const key = `${kind}:${entry.slot}`;
                    busy.add(key); render();
                    try {
                        const item = await uploadFile(file);
                        if (entry.edit && typeof entry.edit === "object") item.edit = entry.edit;
                        if (entry.enabled === false) item.enabled = false;
                        state[kind][entry.slot] = item;
                        loaded++;
                    } catch (err) {
                        missing.push(`${label} : upload failed, ${err.message}`);
                    } finally {
                        busy.delete(key); commit();
                    }
                }
            }
            toast(missing.length ? "warn" : "success", "Media imported",
                `${loaded} file${loaded === 1 ? "" : "s"} loaded in ${rows} row${rows > 1 ? "s" : ""} of slots`
                + (missing.length ? ` \u2014 ${missing.length} skipped : ${missing.join(" ; ")}` : ""));
        } finally {
            importing = false;
            render();
        }
    }

    // ── export ──
    let exporting = false;
    async function exportAll() {
        if (exporting) return;
        exporting = true;
        render();
        try {
            const result = await exportMedia(JSON.stringify(state));
            const detail = `${result.copied} file${result.copied === 1 ? "" : "s"} copied to output/ntx_media/${result.name}`
                + (result.missing?.length ? ` \u2014 ${result.missing.length} missing : ${result.missing.join(", ")}` : "");
            toast(result.missing?.length ? "warn" : "success", "Media exported", detail);
        } catch (err) {
            toast("error", "Export failed", err.message);
        } finally {
            exporting = false;
            render();
        }
    }

    async function clearAll() {
        const count = loadedCount();
        if (!count) return;
        const ok = await confirmDialog("Clear media loader",
            `Remove all ${count} loaded file${count > 1 ? "s" : ""} from the slots ? The files stay in the input folder.`);
        if (!ok) return;
        state = emptyState();
        commit();
    }

    // ── drop handling ──
    // files dropped on the panel but outside any slot go to the first free slots of their kind
    function hasFiles(ev) { return ev.dataTransfer?.types?.includes("Files"); }
    panel.addEventListener("dragover", (ev) => {
        if (!hasFiles(ev)) return;
        ev.preventDefault(); ev.stopPropagation();
        panel.classList.add("drop");
    });
    panel.addEventListener("dragleave", (ev) => {
        if (ev.target === panel) panel.classList.remove("drop");
    });
    panel.addEventListener("drop", (ev) => {
        if (!ev.dataTransfer?.files?.length) return;
        ev.preventDefault(); ev.stopPropagation();
        panel.classList.remove("drop");
        addFiles([...ev.dataTransfer.files], null, null);
    });

    function dropTarget(slot, kind, index) {
        slot.dataset.kind = kind;
        slot.dataset.index = String(index);
        slot.addEventListener("dragover", (ev) => {
            if (!hasFiles(ev)) return;
            ev.preventDefault(); ev.stopPropagation();
            slot.classList.add("hot");
        });
        slot.addEventListener("dragleave", () => slot.classList.remove("hot"));
        slot.addEventListener("drop", (ev) => {
            if (!ev.dataTransfer?.files?.length) return;
            ev.preventDefault(); ev.stopPropagation();
            slot.classList.remove("hot");
            panel.classList.remove("drop");
            addFiles([...ev.dataTransfer.files], kind, index);
        });
        return slot;
    }

    // ── rendering ──
    function emptySlot(kind, index) {
        const spec = KINDS[kind];
        const isBusy = busy.has(`${kind}:${index}`);
        const slot = el("div", {
            class: "nml-slot" + (isBusy ? " busy" : ""),
            title: `${spec.label} slot ${index + 1} — click to browse or drop a file`,
            onclick: () => { if (!isBusy) openPicker(kind, index); },
        }, isBusy ? "uploading…" : `${spec.label} ${index + 1}`);
        return dropTarget(slot, kind, index);
    }

    function filledSlot(kind, index, item) {
        const spec = KINDS[kind];
        const url = viewURL(item);
        const slot = el("div", {
            class: `nml-slot filled ${spec.css}` + (item.enabled === false ? " off" : ""),
            title: `${item.name} — click to replace, drop a file to replace`,
            onclick: () => openPicker(kind, index),
        });
        if (kind === "pictures") {
            const img = el("img", { src: url, alt: item.name, draggable: false });
            slot.append(img);
            // the size overlay needs the picture's dimensions, known once it is loaded ; an
            // edited picture is then also previewed through a canvas, the img staying (hidden)
            // as the source of the move ghost
            const size = el("div", { class: "nml-size" });
            img.addEventListener("load", () => {
                if (!img.isConnected) return;
                size.textContent = sizeLabel(img.naturalWidth, img.naturalHeight, item.edit);
                size.title = `edited size ${size.textContent}, original ${img.naturalWidth}×${img.naturalHeight}`;
                if (isEdited(item.edit)) {
                    const canvas = paintEdited(img, item.edit, 256);
                    img.style.display = "none";
                    slot.insertBefore(canvas, img);
                }
            });
            slot.append(size);
            slot.append(el("div", { class: "nml-name" }, item.name));
            slot.append(toggleFor(kind, index, item));
            slot.append(el("div", { class: "nml-zoom", title: "View at full size",
                onclick: (ev) => { ev.stopPropagation(); lightbox(item); } }, "\ud83d\udd0d"));
            const edited = isEdited(item.edit);
            slot.append(el("div", { class: "nml-edit" + (edited ? " on" : ""),
                title: edited ? `Edit (${describeEdit(item.edit)})` : "Edit : rotate, mirror, crop, max size",
                onclick: (ev) => {
                    ev.stopPropagation();
                    openEditor(item, viewURL(item), (edit) => {
                        const live = state[kind][index];
                        if (!live || live.file !== item.file) return;   // the slot changed meanwhile
                        if (edit) live.edit = edit; else delete live.edit;
                        commit();
                    });
                } }, "\u270e"));
            slot.append(gripFor(kind, index, item));
        } else if (kind === "videos") {
            const video = el("video", { src: url, muted: true, loop: true, playsInline: true, preload: "metadata" });
            // the preview shows the mirrors and starts at the kept span (the crop is not shown)
            const vedit = normalizeVideoEdit(item.edit);
            if (vedit.mirror_h || vedit.mirror_v) video.style.transform = `scale(${vedit.mirror_h ? -1 : 1}, ${vedit.mirror_v ? -1 : 1})`;
            video.addEventListener("loadedmetadata", () => { if (vedit.start > 0) video.currentTime = vedit.start; });
            slot.addEventListener("mouseenter", () => { video.play().catch(() => {}); });
            slot.addEventListener("mouseleave", () => { video.pause(); });
            slot.append(video, el("div", { class: "nml-name" }, item.name));
            slot.append(toggleFor(kind, index, item));
            const edited = isVideoEdited(item.edit);
            slot.append(el("div", { class: "nml-edit" + (edited ? " on" : ""),
                title: edited ? `Edit (${describeVideoEdit(item.edit)})` : "Edit : trim, mirror, crop, max size",
                onclick: (ev) => {
                    ev.stopPropagation();
                    openVideoEditor(item, viewURL(item), (edit) => {
                        const live = state[kind][index];
                        if (!live || live.file !== item.file) return;   // the slot changed meanwhile
                        if (edit) live.edit = edit; else delete live.edit;
                        commit();
                    }, editorActions);
                } }, "✎"));
            slot.append(gripFor(kind, index, item));
        } else {
            const audio = el("audio", { src: url, controls: true, preload: "none" });
            audio.addEventListener("click", (ev) => ev.stopPropagation());
            // the player starts at the kept span
            const aedit = normalizeAudioEdit(item.edit);
            audio.addEventListener("loadedmetadata", () => { if (aedit.start > 0) audio.currentTime = aedit.start; });
            const edited = isAudioEdited(item.edit);
            const pencil = el("div", { class: "nml-edit" + (edited ? " on" : ""),
                title: edited ? `Edit (${describeAudioEdit(item.edit)})` : "Edit : trim",
                onclick: (ev) => {
                    ev.stopPropagation();
                    openAudioEditor(item, viewURL(item), (edit) => {
                        const live = state[kind][index];
                        if (!live || live.file !== item.file) return;   // the slot changed meanwhile
                        if (edit) live.edit = edit; else delete live.edit;
                        commit();
                    });
                } }, "✎");
            slot.append(el("div", { class: "nml-arow" },
                el("span", { class: "nml-glyph" }, "♪"),
                el("span", { class: "nml-aname", title: item.name }, item.name),
                audio, toggleFor(kind, index, item), pencil, gripFor(kind, index, item)));
        }
        slot.append(el("div", {
            class: "nml-remove",
            title: "Remove from this slot (the file stays in the input folder)",
            onclick: (ev) => { ev.stopPropagation(); remove(kind, index); },
        }, "×"));
        return dropTarget(slot, kind, index);
    }

    function section(kind) {
        const spec = KINDS[kind];
        const used = state[kind].filter(Boolean).length;
        const header = el("div", { class: "nml-sec" }, `${spec.label}s`, el("span", {}, `${used}/${state[kind].length}`));
        const grid = el("div", { class: `nml-grid ${kind}`, style: { gridTemplateRows: `repeat(${state.rows}, 1fr)` } });
        state[kind].forEach((item, i) => {
            grid.append(item && !busy.has(`${kind}:${i}`) ? filledSlot(kind, i, item) : emptySlot(kind, i));
        });
        return [header, grid];
    }

    function topBar() {
        const count = loadedCount();
        return el("div", { class: "nml-top" },
            el("span", { class: "nml-hint" }, "click a slot to browse, or drop files on it"),
            el("button", { class: "nml-btn", title: "Add a row of slots : 3 pictures, 1 video, 1 audio",
                onclick: (ev) => { ev.stopPropagation(); addRow(); } }, "Add slots"),
            el("button", { class: "nml-btn", disabled: state.rows <= MIN_ROWS,
                title: "Remove the last row of slots : 3 pictures, 1 video, 1 audio",
                onclick: (ev) => { ev.stopPropagation(); removeRow(); } }, "Remove slots"),
            el("button", { class: "nml-btn", disabled: !count || loadingMissing,
                title: "Check that every loaded file is still on the server, and upload the missing ones from a folder of this machine",
                onclick: (ev) => { ev.stopPropagation(); loadMissing(); } }, loadingMissing ? "checking\u2026" : "Load missing"),
            el("button", { class: "nml-btn", disabled: !count || exporting,
                title: "Copy every loaded file, with a media.json describing the slots, into a new folder of output/ntx_media named after the current time",
                onclick: (ev) => { ev.stopPropagation(); exportAll(); } }, exporting ? "exporting\u2026" : "Export"),
            el("button", { class: "nml-btn", disabled: importing,
                title: "Load the content of an exported folder (its media.json and files) into this node, replacing what is loaded",
                onclick: (ev) => { ev.stopPropagation(); importAll(); } }, importing ? "importing\u2026" : "Import"),
            el("button", { class: "nml-btn danger", disabled: !count, title: "Empty every slot",
                onclick: (ev) => { ev.stopPropagation(); clearAll(); } }, "Clear"));
    }

    function render() {
        // the picker stays: it is the first child and must survive every redraw
        while (panel.childNodes.length > 1) panel.lastChild.remove();
        panel.append(topBar());
        const left = el("div", { class: "nml-col" }, section("pictures"));
        const right = el("div", { class: "nml-col right" }, section("videos"), section("audios"));
        panel.append(el("div", { class: "nml-cols" }, left, right));
    }

    const widget = node.addDOMWidget(inputName, WIDGET_TYPE, panel, {
        getValue() { return JSON.stringify(state); },
        setValue(v) { state = parseState(v); render(); },
    });

    widget.computeSize = function (width) {
        return [width, panelHeight(state.rows)];
    };

    widget.__isMediaLoaderUI = true;
    // what the node's right click menu drives, the panel's own state being a closure
    widget.__nmlApi = { pasteFromClipboard };

    // node-level hooks, installed once (rebuildMediaUI may build the widget again on the same node)
    if (!node.__nmlNodeHooksInstalled) {
        node.__nmlNodeHooksInstalled = true;

        const origOnResize = node.onResize?.bind(node);
        node.onResize = function (size) {
            origOnResize?.apply(this, arguments);
            const min = node.computeSize();
            if (size[0] < NODE_MIN_WIDTH) size[0] = NODE_MIN_WIDTH;
            if (size[1] < min[1]) size[1] = min[1];
        };
    }

    render();
    return widget;
}

function getMediaWidget(node) {
    return node.widgets?.find(w => w.name === WIDGET_NAME);
}

// ── UI rebuild ────────────────────────────────────────────────────────────────
// If the node is re-created from the unpatched Python definition, media_state
// shows up as a raw-JSON STRING widget — replace it with the slot panel,
// preserving the value (same recovery strategy as the lora_stack UI).

// True while the node is still part of its graph (node.graph alone stays set on
// nodes dropped by a graph reload, see loras.lora_stack.js).
function isNodeAlive(node) {
    return !!node?.graph && node.graph.getNodeById(node.id) === node;
}

function rebuildMediaUI(node, force = false) {
    if (!node.widgets || !isNodeAlive(node)) return;
    const idx = node.widgets.findIndex(w => w.name === WIDGET_NAME);
    if (idx === -1) return;

    const old = node.widgets[idx];
    if (!force && old.__isMediaLoaderUI) return;

    let value = old.value ?? "{}";
    if (typeof value !== "string") {
        try { value = JSON.stringify(value); } catch { value = "{}"; }
    }

    try { old.onRemove?.(); } catch { /* ignore */ }
    old.element?.remove?.();
    node.widgets.splice(idx, 1);

    // addDOMWidget appends at the end — move the new widget back to the
    // original slot so widgets_values serialisation order is preserved.
    const widget = makeMediaWidget(node, WIDGET_NAME, value);
    const newIdx = node.widgets.indexOf(widget);
    if (newIdx !== -1 && newIdx !== idx) {
        node.widgets.splice(newIdx, 1);
        node.widgets.splice(idx, 0, widget);
    }
}

// ── Extension registration ────────────────────────────────────────────────────

// RMB entries of the loader, grouped into the addon submenu
registerNodeMenu((node) => {
    if (node?.comfyClass !== NODE_ID) return [];
    return [{
        content: "Paste picture from clipboard",
        callback: () => { void getMediaWidget(node)?.__nmlApi?.pasteFromClipboard?.(); },
    }];
});

app.registerExtension({
    name: API_PREFIX + ".media_loader",

    // Patch the media_state input to the custom widget type. Done here rather
    // than in addCustomNodeDefs because beforeRegisterNodeDef also runs when the
    // frontend re-fetches the definitions after a backend restart.
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_ID || !nodeData.input) return;
        for (const group of ["required", "optional"]) {
            const spec = nodeData.input[group]?.[WIDGET_NAME];
            if (spec) {
                nodeData.input[group][WIDGET_NAME] = [WIDGET_TYPE, { ...(spec[1] ?? {}), default: "{}" }];
            }
        }
    },

    getCustomWidgets() {
        return {
            [WIDGET_TYPE](node, inputName, inputData) {
                const widget = makeMediaWidget(node, inputName, inputData[1]?.default ?? "{}");
                return { widget };
            },
        };
    },

    nodeCreated(node) {
        if (node.comfyClass !== NODE_ID) return;
        rebuildMediaUI(node);
        const min = node.computeSize();
        node.setSize([Math.max(NODE_MIN_WIDTH, node.size[0]), Math.max(min[1], node.size[1])]);
    },

    // Called for every node each time a graph is (re)loaded — repair the UI if
    // deserialisation produced the raw-JSON fallback widget.
    loadedGraphNode(node) {
        if (node.comfyClass !== NODE_ID) return;
        rebuildMediaUI(node);
        // DOM widgets mount asynchronously after load; verify shortly after
        // and force a rebuild if the element never attached.
        setTimeout(() => {
            if (!isNodeAlive(node)) return;
            const w = getMediaWidget(node);
            if (w?.__isMediaLoaderUI && !w.element?.isConnected) rebuildMediaUI(node, true);
        }, 250);
    },
});
