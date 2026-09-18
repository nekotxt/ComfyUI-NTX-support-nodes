// CREATED WITH CLAUDE
//
// Video editor of the Media Loader node (web/js/media_loader.js).
//
// Like the picture editor (media_loader.editor.js) it never touches the file :
// it records a set of edits on the slot item, which the node hands out in its
// NTX_MEDIA_REFS bundle for a downstream node to apply. A video's edit record is
//   { mirror_h: bool, mirror_v: bool, crop: { x, y, width, height } | null,
//     max_size: 0 | 512 | 832 | ..., start: seconds, end: seconds | null }
// and describes this pipeline, in this order :
//   1. keep only the span from `start` to `end` (null : up to the end),
//   2. mirror the frames horizontally (mirror_h) and / or vertically (mirror_v),
//   3. crop them to `crop`, given in pixels of the mirrored frame (null : no crop),
//   4. scale them down so the longer side is at most `max_size` (0 : no limit).
// Mirroring while a crop exists carries the crop along, so it keeps covering the
// same pixels. The crop rectangle is drawn, moved and resized exactly as in the
// picture editor, whose geometry this module imports.
//
// The interface : the edit commands on top, the video preview drawn on a canvas
// (so the mirrors and the crop overlay show live), a timeline under it with the
// start and end bars and the playhead, a transport row, and the Reset / Accept /
// Cancel buttons at the bottom.
//
// openVideoEditor(item, url, onApply) shows the modal editor for a slot item ;
// the edits are worked on a copy and only reach the item through Accept.

import { MAX_SIZES, ASPECTS, MULTIPLES, HANDLES, HANDLE_CURSORS, dragRect, resizeRect } from "./media_loader.editor.js";

// the shortest span a video can be trimmed to, in seconds
const MIN_SPAN = 0.1;
// one step of the frame buttons, in seconds
const FRAME_STEP = 1 / 25;

// ── Edit records ──────────────────────────────────────────────────────────────

export function defaultVideoEdit() {
    return { mirror_h: false, mirror_v: false, crop: null, max_size: 0, start: 0, end: null };
}

// a well formed copy of a video edit record (anything odd falls back to the default)
export function normalizeVideoEdit(edit) {
    const e = defaultVideoEdit();
    if (!edit || typeof edit !== "object") return e;
    e.mirror_h = !!edit.mirror_h;
    e.mirror_v = !!edit.mirror_v;
    const c = edit.crop;
    if (c && typeof c === "object") {
        const r = { x: Math.round(+c.x || 0), y: Math.round(+c.y || 0), width: Math.round(+c.width || 0), height: Math.round(+c.height || 0) };
        if (r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0) e.crop = r;
    }
    const m = parseInt(edit.max_size, 10);
    if (MAX_SIZES.includes(m)) e.max_size = m;
    const start = parseFloat(edit.start);
    if (Number.isFinite(start) && start > 0) e.start = round3(start);
    const end = edit.end == null ? null : parseFloat(edit.end);
    if (end != null && Number.isFinite(end) && end > e.start) e.end = round3(end);
    return e;
}

export function isVideoEdited(edit) {
    const e = normalizeVideoEdit(edit);
    return e.mirror_h || e.mirror_v || !!e.crop || e.max_size !== 0 || e.start > 0 || e.end != null;
}

// a short description of the edits, for tooltips
export function describeVideoEdit(edit) {
    const e = normalizeVideoEdit(edit);
    const parts = [];
    if (e.start > 0 || e.end != null) parts.push(`${fmtTime(e.start)} – ${e.end == null ? "end" : fmtTime(e.end)}`);
    if (e.mirror_h) parts.push("mirrored horizontally");
    if (e.mirror_v) parts.push("mirrored vertically");
    if (e.crop) parts.push(`cropped to ${e.crop.width}x${e.crop.height}`);
    if (e.max_size) parts.push(`max ${e.max_size}px`);
    return parts.join(", ");
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// a time as m:ss.t
export function fmtTime(s) {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

// size of the edited frames (after crop and max size)
function outputSize(w, h, edit) {
    let ow = edit.crop ? edit.crop.width : w, oh = edit.crop ? edit.crop.height : h;
    if (edit.max_size && Math.max(ow, oh) > edit.max_size) {
        const s = edit.max_size / Math.max(ow, oh);
        ow = Math.max(1, Math.round(ow * s));
        oh = Math.max(1, Math.round(oh * s));
    }
    return [ow, oh];
}

// mirror a crop rectangle along with the frame
function mirrorCrop(crop, axis, w, h) {
    if (!crop) return null;
    return axis === "h"
        ? { ...crop, x: w - crop.x - crop.width }
        : { ...crop, y: h - crop.y - crop.height };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.nmv-overlay {
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
.nmv-modal {
    width: min(1100px, 94vw);
    height: min(860px, 92vh);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    box-sizing: border-box;
    background: #191c22;
    border: 1px solid #303642;
    border-radius: 8px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, .55);
}
.nmv-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 24px; }
.nmv-bar .nmv-name { font-weight: bold; margin-right: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
.nmv-bar .nmv-sep { width: 1px; height: 18px; background: #303642; margin: 0 4px; }
.nmv-bar label { color: #8a93a3; margin-left: 6px; }
.nmv-bar select {
    background: #1e232c; color: #c8cfda; border: 1px solid #3a4150; border-radius: 4px;
    font-size: 11px; padding: 1px 4px;
}
.nmv-btn {
    border: 1px solid #3a4150;
    border-radius: 4px;
    background: #1e232c;
    color: #c8cfda;
    font-size: 11px;
    padding: 3px 9px;
    cursor: pointer;
    white-space: nowrap;
}
.nmv-btn:hover { background: #2a303b; border-color: #59637a; }
.nmv-btn:disabled { opacity: .4; cursor: default; }
.nmv-btn.on { background: #2b4a7a; border-color: #6f86b8; color: #fff; }
.nmv-btn.primary { background: #2b5a3a; border-color: #4c8a5c; }
.nmv-btn.primary:hover { background: #357048; }
.nmv-btn.danger:hover { background: #7a2e2e; border-color: #a04040; color: #fff; }
.nmv-btn.icon { padding: 3px 7px; font-size: 12px; min-width: 30px; }
.nmv-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0c10;
    border: 1px solid #262b35;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
}
.nmv-stage canvas { display: block; touch-action: none; }
.nmv-stage .nmv-loading { color: #6b7484; }
.nmv-timeline { display: block; width: 100%; height: 58px; touch-action: none; cursor: pointer; }
.nmv-tlrow { display: flex; justify-content: flex-end; gap: 6px; font-family: ui-monospace, monospace; font-size: 10px; color: #8a93a3; margin-top: -4px; }
.nmv-tlrow b { color: #e8c56a; font-weight: normal; }
.nmv-transport { display: flex; align-items: center; gap: 6px; }
.nmv-transport .nmv-group { display: flex; align-items: center; gap: 4px; }
.nmv-transport .nmv-spacer { flex: 1; }
.nmv-transport input {
    width: 58px; background: #0f1116; color: #c8cfda; border: 1px solid #3a4150; border-radius: 4px;
    font-family: ui-monospace, monospace; font-size: 11px; padding: 2px 4px; text-align: right;
}
.nmv-transport .nmv-kept { color: #8a93a3; font-family: ui-monospace, monospace; }
.nmv-info { display: flex; gap: 16px; color: #8a93a3; min-height: 16px; white-space: nowrap; overflow: hidden; }
.nmv-info b { color: #c8cfda; font-weight: normal; }
.nmv-foot { display: flex; align-items: center; gap: 6px; }
.nmv-foot .nmv-spacer { flex: 1; }
`;

let cssInjected = false;
function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
}

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

// replace an element's children, skipping null entries and flattening arrays
function fill(parent, ...children) {
    parent.replaceChildren(...children.flat(Infinity).filter(c => c != null));
}

function select(options, value, onchange, labels = null) {
    const s = el("select", { onchange: (ev) => onchange(ev.target.value) });
    options.forEach((o, i) => s.append(el("option", { value: String(o), selected: String(o) === String(value) }, labels ? labels[i] : String(o))));
    return s;
}

// the tick spacing giving about ten ticks over a duration
function tickStep(duration) {
    for (const step of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
        if (duration / step <= 10) return step;
    }
    return 600;
}

// ── Editor ────────────────────────────────────────────────────────────────────

// open the editor on a slot item ; onApply(edit) receives the new edit record
// (or null when every edit was removed) when the user accepts
export function openVideoEditor(item, url, onApply) {
    injectCSS();

    let edit = normalizeVideoEdit(item.edit);
    let cropping = false;
    let aspect = "free";
    let mult = 1;
    let ready = false;              // metadata loaded
    let scale = 1;                  // canvas px per frame px
    let drag = null;                // an ongoing crop drag
    let tlDrag = null;              // an ongoing timeline drag : "start" | "end" | "scrub"
    let raf = 0;

    const video = el("video", { src: url, preload: "auto", playsInline: true });
    const canvas = el("canvas");
    const ctx = canvas.getContext("2d");
    const stage = el("div", { class: "nmv-stage" }, el("span", { class: "nmv-loading" }, "loading…"));
    const timeline = el("canvas", { class: "nmv-timeline" });
    const tctx = timeline.getContext("2d");
    const playheadLabel = el("div", { class: "nmv-tlrow" });
    const transport = el("div", { class: "nmv-transport" });
    const info = el("div", { class: "nmv-info" });
    const bar = el("div", { class: "nmv-bar" });
    const modal = el("div", { class: "nmv-modal" }, bar, stage, timeline, playheadLabel, transport, info);
    const overlay = el("div", { class: "nmv-overlay" }, modal);

    const close = () => {
        video.pause();
        cancelAnimationFrame(raf);
        overlay.remove();
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", layout);
    };
    const onKey = (ev) => {
        if (ev.key === "Escape") { ev.stopPropagation(); close(); }
        else if (ev.key === " " && ready && !["INPUT", "SELECT", "BUTTON"].includes(document.activeElement?.tagName)) {
            ev.preventDefault(); ev.stopPropagation(); togglePlay();
        }
    };

    // ── time range ──
    const duration = () => video.duration || 0;
    const rangeEnd = () => edit.end ?? duration();
    const clampTime = (t) => Math.min(duration(), Math.max(0, t));
    function setStart(t) {
        edit.start = round3(Math.min(Math.max(0, t), rangeEnd() - MIN_SPAN));
        if (video.currentTime < edit.start) seek(edit.start);
        refresh();
    }
    function setEnd(t) {
        t = Math.max(edit.start + MIN_SPAN, Math.min(duration(), t));
        edit.end = t >= duration() - 0.0005 ? null : round3(t);
        if (video.currentTime > rangeEnd()) seek(rangeEnd());
        refresh();
    }
    function seek(t) {
        video.currentTime = clampTime(t);
    }
    function togglePlay() {
        if (video.paused) {
            if (video.currentTime >= rangeEnd() - 0.01 || video.currentTime < edit.start) seek(edit.start);
            video.play().catch(() => {});
        } else {
            video.pause();
        }
        drawTransport();
    }

    // ── toolbar ──
    function mirror(axis) {
        edit.crop = mirrorCrop(edit.crop, axis, video.videoWidth, video.videoHeight);
        if (axis === "h") edit.mirror_h = !edit.mirror_h; else edit.mirror_v = !edit.mirror_v;
        layout();
    }
    function drawBar() {
        fill(bar,
            el("span", { class: "nmv-name", title: item.name }, item.name),
            el("button", { class: "nmv-btn" + (edit.mirror_h ? " on" : ""), title: "Mirror horizontally", onclick: () => mirror("h") }, "↔ Mirror"),
            el("button", { class: "nmv-btn" + (edit.mirror_v ? " on" : ""), title: "Mirror vertically", onclick: () => mirror("v") }, "↕ Mirror"),
            el("span", { class: "nmv-sep" }),
            el("button", { class: "nmv-btn" + (cropping ? " on" : ""), title: "Drag a rectangle on the video to crop it",
                onclick: () => { cropping = !cropping; canvas.style.cursor = ""; layout(); } }, "▣ Crop"),
            cropping ? [
                el("label", {}, "aspect"),
                select(ASPECTS, aspect, (v) => { aspect = v; }),
                el("label", {}, "multiples of"),
                select(MULTIPLES, mult, (v) => { mult = parseInt(v, 10); }),
                el("button", { class: "nmv-btn", disabled: !edit.crop, title: "Remove the crop rectangle",
                    onclick: () => { edit.crop = null; layout(); } }, "Clear crop"),
            ] : null,
            el("span", { class: "nmv-sep" }),
            el("label", {}, "max size"),
            select(MAX_SIZES, edit.max_size, (v) => { edit.max_size = parseInt(v, 10); drawInfo(); },
                MAX_SIZES.map(m => m ? String(m) : "max")),
        );
    }

    // ── footer ──
    modal.append(el("div", { class: "nmv-foot" },
        el("button", { class: "nmv-btn danger", title: "Delete every edit and restore the original video",
            onclick: () => { edit = defaultVideoEdit(); seek(0); layout(); } }, "Reset"),
        el("span", { class: "nmv-spacer" }),
        el("button", { class: "nmv-btn primary", title: "Keep these edits and close",
            onclick: () => { onApply(isVideoEdited(edit) ? normalizeVideoEdit(edit) : null); close(); } }, "Accept"),
        el("button", { class: "nmv-btn", title: "Discard the changes made here and close", onclick: close }, "Cancel"),
    ));

    // ── stage ──
    function frameSize() { return [video.videoWidth, video.videoHeight]; }

    // size the canvases to the modal and redraw everything
    function layout() {
        drawBar();
        if (!ready) return;
        const [fw, fh] = frameSize();
        const boxW = Math.max(50, stage.clientWidth - 16), boxH = Math.max(50, stage.clientHeight - 16);
        scale = Math.min(boxW / fw, boxH / fh);
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${Math.round(fw * scale)}px`;
        canvas.style.height = `${Math.round(fh * scale)}px`;
        canvas.width = Math.round(fw * scale * dpr);
        canvas.height = Math.round(fh * scale * dpr);
        timeline.width = Math.round(timeline.clientWidth * dpr);
        timeline.height = Math.round(timeline.clientHeight * dpr);
        refresh();
    }

    // redraw the frame, the timeline, the transport and the info line
    function refresh() {
        draw();
        drawTimeline();
        drawTransport();
        drawInfo();
    }

    function draw() {
        if (!ready) return;
        const dpr = window.devicePixelRatio || 1;
        const [fw, fh] = frameSize();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, fw * scale, fh * scale);
        ctx.save();
        ctx.translate(edit.mirror_h ? fw * scale : 0, edit.mirror_v ? fh * scale : 0);
        ctx.scale(edit.mirror_h ? -1 : 1, edit.mirror_v ? -1 : 1);
        try { ctx.drawImage(video, 0, 0, fw * scale, fh * scale); } catch { /* no frame yet */ }
        ctx.restore();
        const crop = drag?.rect ?? edit.crop;
        if (crop) {
            const x = crop.x * scale, y = crop.y * scale, w = crop.width * scale, h = crop.height * scale;
            ctx.fillStyle = "rgba(8, 10, 14, .6)";
            ctx.fillRect(0, 0, fw * scale, y);
            ctx.fillRect(0, y + h, fw * scale, fh * scale - y - h);
            ctx.fillRect(0, y, x, h);
            ctx.fillRect(x + w, y, fw * scale - x - w, h);
            ctx.strokeStyle = "#6f86b8";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
            if (!drag || drag.mode !== "draw") {
                ctx.fillStyle = "#e8ecf2";
                for (const [fx, fy] of Object.values(HANDLES)) {
                    ctx.fillRect(x + fx * w - 3.5, y + fy * h - 3.5, 7, 7);
                    ctx.strokeRect(x + fx * w - 3.5, y + fy * h - 3.5, 7, 7);
                }
            }
        }
    }

    // ── timeline ──
    const TL_PAD = 10;              // px kept free at both ends, for the bars
    const TL_TOP = 22;              // top of the range bar (the ticks sit above)
    const TL_BOTTOM = 52;
    function tlWidth() { return timeline.clientWidth; }
    function tlX(t) { return TL_PAD + (duration() ? t / duration() : 0) * (tlWidth() - 2 * TL_PAD); }
    function tlT(x) { return clampTime((x - TL_PAD) / (tlWidth() - 2 * TL_PAD) * duration()); }

    function drawTimeline() {
        if (!ready) return;
        const dpr = window.devicePixelRatio || 1;
        const W = tlWidth(), H = timeline.clientHeight;
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        tctx.clearRect(0, 0, W, H);
        // ticks
        const step = tickStep(duration());
        tctx.fillStyle = "#6b7484";
        tctx.strokeStyle = "#3a4150";
        tctx.font = "10px ui-monospace, monospace";
        tctx.textAlign = "center";
        tctx.textBaseline = "top";
        for (let t = 0; t <= duration() + 1e-6; t += step) {
            const x = Math.round(tlX(t)) + .5;
            tctx.beginPath(); tctx.moveTo(x, TL_TOP - 6); tctx.lineTo(x, TL_TOP - 1); tctx.stroke();
            tctx.fillText(fmtTime(t), Math.min(W - 16, Math.max(16, x)), 2);
        }
        // the whole video, then the kept span
        tctx.fillStyle = "#141820";
        tctx.fillRect(TL_PAD, TL_TOP, W - 2 * TL_PAD, TL_BOTTOM - TL_TOP);
        const xs = tlX(edit.start), xe = tlX(rangeEnd());
        tctx.fillStyle = "#3d6f85";
        tctx.fillRect(xs, TL_TOP, xe - xs, TL_BOTTOM - TL_TOP);
        // the start and end bars
        tctx.fillStyle = "#7fb8d8";
        for (const x of [xs, xe]) {
            tctx.beginPath();
            tctx.roundRect(x - 4, TL_TOP - 3, 8, TL_BOTTOM - TL_TOP + 6, 3);
            tctx.fill();
        }
        // the playhead
        const xp = tlX(video.currentTime);
        tctx.strokeStyle = "#e8c56a";
        tctx.fillStyle = "#e8c56a";
        tctx.lineWidth = 2;
        tctx.beginPath(); tctx.moveTo(xp, TL_TOP - 8); tctx.lineTo(xp, TL_BOTTOM + 3); tctx.stroke();
        tctx.beginPath(); tctx.moveTo(xp - 5, TL_TOP - 12); tctx.lineTo(xp + 5, TL_TOP - 12); tctx.lineTo(xp, TL_TOP - 6); tctx.closePath(); tctx.fill();
        fill(playheadLabel, "PLAYHEAD ", el("b", {}, fmtTime(video.currentTime)));
    }

    // what the pointer is on : a bar, or the track
    function tlHit(ev) {
        const x = ev.clientX - timeline.getBoundingClientRect().left;
        if (Math.abs(x - tlX(edit.start)) <= 7) return "start";
        if (Math.abs(x - tlX(rangeEnd())) <= 7) return "end";
        return "scrub";
    }
    timeline.addEventListener("pointerdown", (ev) => {
        if (!ready || ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        tlDrag = tlHit(ev);
        if (tlDrag !== "scrub") video.pause();
        try { timeline.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
        tlMove(ev);
    });
    function tlMove(ev) {
        const t = tlT(ev.clientX - timeline.getBoundingClientRect().left);
        if (tlDrag === "start") { setStart(t); seek(edit.start); }
        else if (tlDrag === "end") { setEnd(t); seek(rangeEnd()); }
        else seek(t);
        refresh();
    }
    timeline.addEventListener("pointermove", (ev) => {
        if (!ready) return;
        if (!tlDrag) { timeline.style.cursor = tlHit(ev) === "scrub" ? "pointer" : "ew-resize"; return; }
        tlMove(ev);
    });
    const tlEnd = (ev) => {
        if (!tlDrag) return;
        try { timeline.releasePointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
        tlDrag = null;
        refresh();
    };
    timeline.addEventListener("pointerup", tlEnd);
    timeline.addEventListener("pointercancel", tlEnd);

    // ── transport ──
    function drawTransport() {
        const kept = rangeEnd() - edit.start;
        const timeInput = (value, onchange, title) => el("input", { value: value.toFixed(2), title,
            onchange: (ev) => { const v = parseFloat(ev.target.value); if (Number.isFinite(v)) onchange(v); else refresh(); },
            onkeydown: (ev) => { if (ev.key === "Enter") ev.target.blur(); ev.stopPropagation(); } });
        fill(transport,
            el("div", { class: "nmv-group" },
                el("button", { class: "nmv-btn icon", title: "One frame back", onclick: () => { video.pause(); seek(video.currentTime - FRAME_STEP); } }, "◀▎"),
                el("button", { class: "nmv-btn icon", title: video.paused ? "Play (space)" : "Pause (space)", onclick: togglePlay }, video.paused ? "▶" : "❚❚"),
                el("button", { class: "nmv-btn icon" + (video.muted ? "" : " on"), title: video.muted ? "Unmute" : "Mute",
                    onclick: () => { video.muted = !video.muted; drawTransport(); } }, video.muted ? "🔇" : "🔊"),
                el("button", { class: "nmv-btn icon", title: "One frame forward", onclick: () => { video.pause(); seek(video.currentTime + FRAME_STEP); } }, "▎▶"),
            ),
            el("span", { class: "nmv-spacer" }),
            el("div", { class: "nmv-group" },
                el("button", { class: "nmv-btn", title: "Start the kept span at the playhead", onclick: () => setStart(video.currentTime) }, "⇤ start"),
                timeInput(edit.start, setStart, "Start of the kept span, in seconds"),
                el("span", {}, "–"),
                timeInput(rangeEnd(), setEnd, "End of the kept span, in seconds"),
                el("button", { class: "nmv-btn", title: "End the kept span at the playhead", onclick: () => setEnd(video.currentTime) }, "end ⇥"),
                el("span", { class: "nmv-kept" }, `${kept.toFixed(1)}s kept`),
            ),
            el("span", { class: "nmv-spacer" }),
            el("div", { class: "nmv-group" },
                el("button", { class: "nmv-btn", title: "Go to the start of the kept span", onclick: () => { video.pause(); seek(edit.start); } }, "⏮ First"),
                el("button", { class: "nmv-btn", title: "Go to the end of the kept span", onclick: () => { video.pause(); seek(rangeEnd()); } }, "Last ⏭"),
            ),
        );
    }

    function drawInfo() {
        if (!ready) return;
        const [fw, fh] = frameSize();
        const crop = drag?.rect ?? edit.crop;
        const [ow, oh] = outputSize(fw, fh, { ...edit, crop });
        fill(info,
            el("span", {}, "video ", el("b", {}, `${fw} x ${fh}, ${fmtTime(duration())}`)),
            el("span", {}, "crop ", el("b", {}, crop ? `${crop.width} x ${crop.height} at ${crop.x}, ${crop.y}` : "none")),
            el("span", {}, "output ", el("b", {}, `${ow} x ${oh}`)),
            el("span", {}, "kept ", el("b", {}, `${fmtTime(edit.start)} – ${fmtTime(rangeEnd())}`)),
            cropping ? el("span", {}, edit.crop
                ? "drag inside to move, handles to resize, outside to draw anew"
                : "drag on the video to draw the crop rectangle") : null,
        );
    }

    // ── crop pointer handling ──
    function framePoint(ev) {
        const r = canvas.getBoundingClientRect();
        const [fw, fh] = frameSize();
        return { x: Math.min(fw, Math.max(0, (ev.clientX - r.left) / scale)), y: Math.min(fh, Math.max(0, (ev.clientY - r.top) / scale)) };
    }
    function inside(p, c) { return c && p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height; }
    function handleAt(p, c) {
        if (!c) return null;
        const tol = 8 / scale;
        for (const [name, [fx, fy]] of Object.entries(HANDLES)) {
            if (Math.abs(p.x - (c.x + fx * c.width)) <= tol && Math.abs(p.y - (c.y + fy * c.height)) <= tol) return name;
        }
        return null;
    }
    canvas.addEventListener("pointerdown", (ev) => {
        if (!ready || ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        if (!cropping) { togglePlay(); return; }
        const p = framePoint(ev);
        const handle = handleAt(p, edit.crop);
        if (handle) drag = { mode: "resize", handle, origin: { ...edit.crop }, rect: { ...edit.crop } };
        else if (inside(p, edit.crop)) drag = { mode: "move", start: p, origin: { ...edit.crop }, rect: { ...edit.crop } };
        else drag = { mode: "draw", anchor: p, rect: null };
        try { canvas.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
    });
    canvas.addEventListener("pointermove", (ev) => {
        if (!ready) return;
        if (!cropping) { canvas.style.cursor = "pointer"; return; }
        const p = framePoint(ev);
        if (!drag) {
            const handle = handleAt(p, edit.crop);
            canvas.style.cursor = handle ? HANDLE_CURSORS[handle] : inside(p, edit.crop) ? "move" : "crosshair";
            return;
        }
        const [fw, fh] = frameSize();
        if (drag.mode === "move") {
            const o = drag.origin;
            const x = Math.round(Math.min(fw - o.width, Math.max(0, o.x + p.x - drag.start.x)));
            const y = Math.round(Math.min(fh - o.height, Math.max(0, o.y + p.y - drag.start.y)));
            drag.rect = { ...o, x, y };
        } else if (drag.mode === "resize") {
            drag.rect = resizeRect(drag.handle, drag.origin, p, fw, fh, aspect, mult);
        } else {
            drag.rect = dragRect(drag.anchor, p, fw, fh, aspect, mult);
        }
        draw(); drawInfo();
    });
    const endDrag = (ev) => {
        if (!drag) return;
        try { canvas.releasePointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
        if (ev.type === "pointerup") {
            if (drag.mode !== "draw" || drag.rect) edit.crop = drag.rect;
        }
        drag = null;
        layout();
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    // ── playback ──
    // while playing, redraw every frame and loop inside the kept span
    function tick() {
        if (!video.paused && !video.ended) {
            if (video.currentTime >= rangeEnd()) seek(edit.start);
            draw(); drawTimeline();
            raf = requestAnimationFrame(tick);
        }
    }
    video.addEventListener("play", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); drawTransport(); });
    // animation frames stall in a background tab : the media clock still enforces the span
    video.addEventListener("timeupdate", () => {
        if (!video.paused && video.currentTime >= rangeEnd()) seek(edit.start);
    });
    video.addEventListener("pause", () => { cancelAnimationFrame(raf); refresh(); });
    video.addEventListener("seeked", () => { if (video.paused) refresh(); });
    video.addEventListener("ended", () => { drawTransport(); });

    // ── load ──
    video.addEventListener("loadedmetadata", () => {
        ready = true;
        // an existing range or crop must fit the video, else it is dropped
        if (edit.end != null && edit.end > duration()) edit.end = null;
        if (edit.start >= rangeEnd()) edit.start = 0;
        if (edit.crop && (edit.crop.x + edit.crop.width > video.videoWidth || edit.crop.y + edit.crop.height > video.videoHeight)) edit.crop = null;
        stage.replaceChildren(canvas);
        seek(edit.start);
        layout();
    });
    video.addEventListener("loadeddata", () => { if (ready) draw(); });
    video.addEventListener("error", () => {
        stage.replaceChildren(el("span", { class: "nmv-loading" }, "the video could not be loaded"));
    });

    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", layout);
    drawBar();
    document.body.append(overlay);
    return overlay;
}
