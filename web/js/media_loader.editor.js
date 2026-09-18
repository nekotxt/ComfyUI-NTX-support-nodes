// CREATED WITH CLAUDE
//
// Picture editor of the Media Loader node (web/js/media_loader.js).
//
// The editor never touches the file : it records a set of edits on the slot
// item, which the node hands out in its NTX_MEDIA_REFS bundle for a downstream
// node to apply. An edit record is
//   { rotate: 0 | 90 | 180 | 270, mirror_h: bool, mirror_v: bool,
//     crop: { x, y, width, height } | null, max_size: 0 | 512 | 832 | ... }
// and describes this pipeline, in this order :
//   1. rotate the original picture clockwise by `rotate` degrees,
//   2. mirror it horizontally (mirror_h) and / or vertically (mirror_v),
//   3. crop it to `crop`, given in pixels of the rotated and mirrored picture
//      (null : no crop),
//   4. scale it down so its longer side is at most `max_size` (0 : no limit).
// Rotating or mirroring while a crop exists carries the crop along, so it keeps
// covering the same pixels of the picture. The crop rectangle is drawn by
// dragging on the picture, moved by dragging inside it, and resized by its
// eight handles (corners and side midpoints) ; every one of these honours the
// aspect ratio and the size multiple chosen in the toolbar.
//
// openEditor(item, url, onApply) shows the modal editor for a slot item ; the
// edits are worked on a copy and only reach the item through Apply.
// paintEdited(img, edit, maxSide) draws the edited picture on a canvas, for the
// slot thumbnails.

// ── Edit records ──────────────────────────────────────────────────────────────

export const MAX_SIZES = [0, 512, 832, 1024, 1280, 1600, 1920, 2048];
export const ASPECTS = ["free", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "9:21", "21:9"];
export const MULTIPLES = [1, 2, 4, 5, 8, 10, 16, 32, 50, 100];

export function defaultEdit() {
    return { rotate: 0, mirror_h: false, mirror_v: false, crop: null, max_size: 0 };
}

// a well formed copy of an edit record (anything odd falls back to the default)
export function normalizeEdit(edit) {
    const e = defaultEdit();
    if (!edit || typeof edit !== "object") return e;
    const rotate = parseInt(edit.rotate, 10);
    if ([90, 180, 270].includes(rotate)) e.rotate = rotate;
    e.mirror_h = !!edit.mirror_h;
    e.mirror_v = !!edit.mirror_v;
    const c = edit.crop;
    if (c && typeof c === "object") {
        const r = { x: Math.round(+c.x || 0), y: Math.round(+c.y || 0), width: Math.round(+c.width || 0), height: Math.round(+c.height || 0) };
        if (r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0) e.crop = r;
    }
    const m = parseInt(edit.max_size, 10);
    if (MAX_SIZES.includes(m)) e.max_size = m;
    return e;
}

export function isEdited(edit) {
    const e = normalizeEdit(edit);
    return e.rotate !== 0 || e.mirror_h || e.mirror_v || !!e.crop || e.max_size !== 0;
}

// a short description of the edits, for tooltips
export function describeEdit(edit) {
    const e = normalizeEdit(edit);
    const parts = [];
    if (e.rotate) parts.push(`rotated ${e.rotate}°`);
    if (e.mirror_h) parts.push("mirrored horizontally");
    if (e.mirror_v) parts.push("mirrored vertically");
    if (e.crop) parts.push(`cropped to ${e.crop.width}x${e.crop.height}`);
    if (e.max_size) parts.push(`max ${e.max_size}px`);
    return parts.join(", ");
}

// ── Geometry ──────────────────────────────────────────────────────────────────

// size of the picture once rotated
function turnedSize(w, h, rotate) {
    return rotate === 90 || rotate === 270 ? [h, w] : [w, h];
}

// size of the edited picture (after crop and max size)
export function outputSize(w, h, edit) {
    const e = normalizeEdit(edit);
    let [tw, th] = turnedSize(w, h, e.rotate);
    if (e.crop) { tw = e.crop.width; th = e.crop.height; }
    if (e.max_size && Math.max(tw, th) > e.max_size) {
        const s = e.max_size / Math.max(tw, th);
        tw = Math.max(1, Math.round(tw * s));
        th = Math.max(1, Math.round(th * s));
    }
    return [tw, th];
}

// set the canvas transform so that drawing the original picture at (0, 0)
// lands rotated and mirrored in a [0, tw] x [0, th] box scaled by `scale`
function applyTransform(ctx, w, h, edit, scale) {
    const [tw, th] = turnedSize(w, h, edit.rotate);
    ctx.translate(tw * scale / 2, th * scale / 2);
    ctx.scale(edit.mirror_h ? -1 : 1, edit.mirror_v ? -1 : 1);
    ctx.rotate(edit.rotate * Math.PI / 180);
    ctx.translate(-w * scale / 2, -h * scale / 2);
}

// draw the edited picture (rotate, mirror, crop ; max size only bounds the canvas)
// on a new canvas whose longer side is at most maxSide
export function paintEdited(img, edit, maxSide) {
    const e = normalizeEdit(edit);
    const w = img.naturalWidth, h = img.naturalHeight;
    const [tw, th] = turnedSize(w, h, e.rotate);
    const crop = e.crop || { x: 0, y: 0, width: tw, height: th };
    const scale = Math.min(1, maxSide / Math.max(crop.width, crop.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.translate(-crop.x * scale, -crop.y * scale);
    applyTransform(ctx, w, h, e, scale);
    ctx.drawImage(img, 0, 0, w * scale, h * scale);
    return canvas;
}

// carry a crop rectangle (in the current rotated / mirrored space of size tw x th)
// across a further rotation or mirror of that space
function carryCrop(crop, op, tw, th) {
    if (!crop) return null;
    const { x, y, width: cw, height: ch } = crop;
    switch (op) {
        case "cw":  return { x: th - y - ch, y: x, width: ch, height: cw };
        case "ccw": return { x: y, y: tw - x - cw, width: ch, height: cw };
        case "h":   return { x: tw - x - cw, y, width: cw, height: ch };
        case "v":   return { x, y: th - y - ch, width: cw, height: ch };
    }
    return crop;
}

// apply a further operation on the displayed picture to an edit record, keeping
// the record in its canonical rotate-then-mirror form : a rotation applied after
// the mirrors swaps them (R90 . Mh = Mv . R90)
function applyOp(edit, op, tw, th) {
    const e = { ...edit, crop: carryCrop(edit.crop, op, tw, th) };
    if (op === "cw" || op === "ccw") {
        e.rotate = (e.rotate + (op === "cw" ? 90 : 270)) % 360;
        [e.mirror_h, e.mirror_v] = [e.mirror_v, e.mirror_h];
    } else if (op === "h") {
        e.mirror_h = !e.mirror_h;
    } else if (op === "v") {
        e.mirror_v = !e.mirror_v;
    }
    return e;
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function lcm(a, b) { return a / gcd(a, b) * b; }

// the smallest width / height step honouring both the aspect ratio and the multiple
function cropStep(aspect, mult) {
    if (aspect === "free") return null;
    let [rw, rh] = aspect.split(":").map(Number);
    const g = gcd(rw, rh); rw /= g; rh /= g;
    const n = lcm(mult / gcd(rw, mult), mult / gcd(rh, mult));
    return [rw * n, rh * n];
}

// the crop rectangle for a drag from `anchor` to `cur`, within tw x th, honouring
// the aspect ratio and the size multiple (null when nothing usable was dragged)
function dragRect(anchor, cur, tw, th, aspect, mult) {
    const dx = cur.x - anchor.x, dy = cur.y - anchor.y;
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    const availW = sx > 0 ? tw - anchor.x : anchor.x;
    const availH = sy > 0 ? th - anchor.y : anchor.y;
    let w, h;
    const step = cropStep(aspect, mult);
    if (step) {
        const [uw, uh] = step;
        let k = Math.round(Math.max(Math.abs(dx) / uw, Math.abs(dy) / uh));
        k = Math.min(k, Math.floor(availW / uw), Math.floor(availH / uh));
        if (k < 1) return null;
        w = k * uw; h = k * uh;
    } else {
        w = Math.min(Math.round(Math.abs(dx) / mult) * mult, Math.floor(availW / mult) * mult);
        h = Math.min(Math.round(Math.abs(dy) / mult) * mult, Math.floor(availH / mult) * mult);
        if (w < 1 || h < 1) return null;
    }
    return { x: Math.round(sx > 0 ? anchor.x : anchor.x - w), y: Math.round(sy > 0 ? anchor.y : anchor.y - h), width: w, height: h };
}

// the resize handles of the crop rectangle, as fractions of its width and height
const HANDLES = { nw: [0, 0], n: [.5, 0], ne: [1, 0], e: [1, .5], se: [1, 1], s: [.5, 1], sw: [0, 1], w: [0, .5] };
const HANDLE_CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
                         n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

// the crop rectangle once its `handle` is dragged to `p`, within tw x th, honouring
// the aspect ratio and the size multiple. A corner drags against the opposite
// corner ; a side keeps the opposite side in place and, when the aspect ratio
// forces the other dimension to follow, keeps the rectangle centred on that axis.
function resizeRect(handle, crop, p, tw, th, aspect, mult) {
    const { x, y, width: cw, height: ch } = crop;
    const right = x + cw, bottom = y + ch;
    if (handle.length === 2) {
        const anchor = { x: handle.includes("w") ? right : x, y: handle.includes("n") ? bottom : y };
        return dragRect(anchor, p, tw, th, aspect, mult) ?? crop;
    }
    const step = cropStep(aspect, mult);
    const alongX = handle === "e" || handle === "w";
    const raw = alongX ? (handle === "e" ? p.x - x : right - p.x) : (handle === "s" ? p.y - y : bottom - p.y);
    const avail = alongX ? (handle === "e" ? tw - x : right) : (handle === "s" ? th - y : bottom);
    let w = cw, h = ch;
    if (step) {
        const [uw, uh] = step;
        let k = Math.round(raw / (alongX ? uw : uh));
        k = Math.min(k, Math.floor(avail / (alongX ? uw : uh)), Math.floor((alongX ? th : tw) / (alongX ? uh : uw)));
        if (k < 1) return crop;
        w = k * uw; h = k * uh;
    } else if (alongX) {
        w = Math.min(Math.round(raw / mult) * mult, Math.floor(avail / mult) * mult);
        if (w < 1) return crop;
    } else {
        h = Math.min(Math.round(raw / mult) * mult, Math.floor(avail / mult) * mult);
        if (h < 1) return crop;
    }
    let nx = handle === "w" ? right - w : x;
    let ny = handle === "n" ? bottom - h : y;
    if (!alongX && w !== cw) nx = Math.round(x + (cw - w) / 2);
    if (alongX && h !== ch) ny = Math.round(y + (ch - h) / 2);
    nx = Math.min(Math.max(0, nx), tw - w);
    ny = Math.min(Math.max(0, ny), th - h);
    return { x: Math.round(nx), y: Math.round(ny), width: w, height: h };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.nme-overlay {
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
.nme-modal {
    width: min(1100px, 94vw);
    height: min(820px, 92vh);
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
.nme-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 24px; }
.nme-bar .nme-name { font-weight: bold; margin-right: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
.nme-bar .nme-sep { width: 1px; height: 18px; background: #303642; margin: 0 4px; }
.nme-bar label { color: #8a93a3; margin-left: 6px; }
.nme-bar select {
    background: #1e232c; color: #c8cfda; border: 1px solid #3a4150; border-radius: 4px;
    font-size: 11px; padding: 1px 4px;
}
.nme-btn {
    border: 1px solid #3a4150;
    border-radius: 4px;
    background: #1e232c;
    color: #c8cfda;
    font-size: 11px;
    padding: 3px 9px;
    cursor: pointer;
    white-space: nowrap;
}
.nme-btn:hover { background: #2a303b; border-color: #59637a; }
.nme-btn:disabled { opacity: .4; cursor: default; }
.nme-btn.on { background: #2b4a7a; border-color: #6f86b8; color: #fff; }
.nme-btn.primary { background: #2b5a3a; border-color: #4c8a5c; }
.nme-btn.primary:hover { background: #357048; }
.nme-btn.danger:hover { background: #7a2e2e; border-color: #a04040; color: #fff; }
.nme-stage {
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
.nme-stage canvas { display: block; touch-action: none; }
.nme-stage.cropping canvas { cursor: crosshair; }
.nme-stage .nme-loading { color: #6b7484; }
.nme-info { display: flex; gap: 16px; color: #8a93a3; min-height: 16px; white-space: nowrap; overflow: hidden; }
.nme-info b { color: #c8cfda; font-weight: normal; }
.nme-foot { display: flex; align-items: center; gap: 6px; }
.nme-foot .nme-spacer { flex: 1; }
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

// ── Editor ────────────────────────────────────────────────────────────────────

// open the editor on a slot item ; onApply(edit) receives the new edit record
// (or null when every edit was removed) when the user applies
export function openEditor(item, url, onApply) {
    injectCSS();

    let edit = normalizeEdit(item.edit);
    let cropping = false;
    let aspect = "free";
    let mult = 1;
    let img = null;                 // the loaded picture
    let scale = 1;                  // canvas px per picture px
    let drag = null;                // an ongoing crop drag

    const canvas = el("canvas");
    const ctx = canvas.getContext("2d");
    const stage = el("div", { class: "nme-stage" }, el("span", { class: "nme-loading" }, "loading…"));
    const info = el("div", { class: "nme-info" });
    const bar = el("div", { class: "nme-bar" });
    const modal = el("div", { class: "nme-modal" }, bar, stage, info);
    const overlay = el("div", { class: "nme-overlay" }, modal);

    const close = () => { overlay.remove(); window.removeEventListener("keydown", onKey); window.removeEventListener("resize", layout); };
    const onKey = (ev) => {
        if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    };

    // ── toolbar ──
    function op(name) {
        const [tw, th] = turnedSize(img?.naturalWidth || 0, img?.naturalHeight || 0, edit.rotate);
        edit = applyOp(edit, name, tw, th);
        layout();
    }
    function drawBar() {
        fill(bar,
            el("span", { class: "nme-name", title: item.name }, item.name),
            el("button", { class: "nme-btn", title: "Rotate 90° counter-clockwise", onclick: () => op("ccw") }, "↶ Rotate"),
            el("button", { class: "nme-btn", title: "Rotate 90° clockwise", onclick: () => op("cw") }, "↷ Rotate"),
            el("button", { class: "nme-btn" + (edit.mirror_h ? " on" : ""), title: "Mirror horizontally", onclick: () => op("h") }, "↔ Mirror"),
            el("button", { class: "nme-btn" + (edit.mirror_v ? " on" : ""), title: "Mirror vertically", onclick: () => op("v") }, "↕ Mirror"),
            el("span", { class: "nme-sep" }),
            el("button", { class: "nme-btn" + (cropping ? " on" : ""), title: "Drag a rectangle on the picture to crop it",
                onclick: () => { cropping = !cropping; stage.classList.toggle("cropping", cropping); canvas.style.cursor = ""; layout(); } }, "▣ Crop"),
            cropping ? [
                el("label", {}, "aspect"),
                select(ASPECTS, aspect, (v) => { aspect = v; }),
                el("label", {}, "multiples of"),
                select(MULTIPLES, mult, (v) => { mult = parseInt(v, 10); }),
                el("button", { class: "nme-btn", disabled: !edit.crop, title: "Remove the crop rectangle",
                    onclick: () => { edit.crop = null; layout(); } }, "Clear crop"),
            ] : null,
            el("span", { class: "nme-sep" }),
            el("label", {}, "max size"),
            select(MAX_SIZES, edit.max_size, (v) => { edit.max_size = parseInt(v, 10); drawInfo(); },
                MAX_SIZES.map(m => m ? String(m) : "max")),
        );
    }

    // ── footer ──
    modal.append(el("div", { class: "nme-foot" },
        el("button", { class: "nme-btn danger", title: "Delete every edit and restore the original picture",
            onclick: () => { edit = defaultEdit(); layout(); } }, "Reset"),
        el("span", { class: "nme-spacer" }),
        el("button", { class: "nme-btn primary", title: "Keep these edits and close",
            onclick: () => { onApply(isEdited(edit) ? normalizeEdit(edit) : null); close(); } }, "Apply"),
        el("button", { class: "nme-btn", title: "Discard the changes made here and close", onclick: close }, "Cancel"),
    ));

    // ── stage ──
    function pictureSize() { return turnedSize(img.naturalWidth, img.naturalHeight, edit.rotate); }

    // size the canvas to the stage and redraw
    function layout() {
        drawBar();
        if (!img) return;
        const [tw, th] = pictureSize();
        const boxW = Math.max(50, stage.clientWidth - 16), boxH = Math.max(50, stage.clientHeight - 16);
        scale = Math.min(boxW / tw, boxH / th);
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${Math.round(tw * scale)}px`;
        canvas.style.height = `${Math.round(th * scale)}px`;
        canvas.width = Math.round(tw * scale * dpr);
        canvas.height = Math.round(th * scale * dpr);
        draw();
    }

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const [tw, th] = pictureSize();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, tw * scale, th * scale);
        ctx.save();
        applyTransform(ctx, img.naturalWidth, img.naturalHeight, edit, scale);
        ctx.drawImage(img, 0, 0, img.naturalWidth * scale, img.naturalHeight * scale);
        ctx.restore();
        const crop = drag?.rect ?? edit.crop;
        if (crop) {
            const x = crop.x * scale, y = crop.y * scale, w = crop.width * scale, h = crop.height * scale;
            ctx.fillStyle = "rgba(8, 10, 14, .6)";
            ctx.fillRect(0, 0, tw * scale, y);
            ctx.fillRect(0, y + h, tw * scale, th * scale - y - h);
            ctx.fillRect(0, y, x, h);
            ctx.fillRect(x + w, y, tw * scale - x - w, h);
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
        drawInfo();
    }

    function drawInfo() {
        if (!img) return;
        const [tw, th] = pictureSize();
        const crop = drag?.rect ?? edit.crop;
        const [ow, oh] = outputSize(img.naturalWidth, img.naturalHeight, { ...edit, crop });
        fill(info,
            el("span", {}, "original ", el("b", {}, `${img.naturalWidth} x ${img.naturalHeight}`)),
            el("span", {}, "picture ", el("b", {}, `${tw} x ${th}`)),
            el("span", {}, "crop ", el("b", {}, crop ? `${crop.width} x ${crop.height} at ${crop.x}, ${crop.y}` : "none")),
            el("span", {}, "output ", el("b", {}, `${ow} x ${oh}`)),
            cropping ? el("span", {}, edit.crop
                ? "drag inside to move, handles to resize, outside to draw anew"
                : "drag on the picture to draw the crop rectangle") : null,
        );
    }

    // pointer position in picture pixels
    function picPoint(ev) {
        const r = canvas.getBoundingClientRect();
        const [tw, th] = pictureSize();
        return { x: Math.min(tw, Math.max(0, (ev.clientX - r.left) / scale)), y: Math.min(th, Math.max(0, (ev.clientY - r.top) / scale)) };
    }
    function inside(p, c) { return c && p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height; }
    // the handle under the pointer, within a screen tolerance
    function handleAt(p, c) {
        if (!c) return null;
        const tol = 8 / scale;
        for (const [name, [fx, fy]] of Object.entries(HANDLES)) {
            if (Math.abs(p.x - (c.x + fx * c.width)) <= tol && Math.abs(p.y - (c.y + fy * c.height)) <= tol) return name;
        }
        return null;
    }

    canvas.addEventListener("pointerdown", (ev) => {
        if (!cropping || !img || ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        const p = picPoint(ev);
        const handle = handleAt(p, edit.crop);
        if (handle) drag = { mode: "resize", handle, origin: { ...edit.crop }, rect: { ...edit.crop } };
        else if (inside(p, edit.crop)) drag = { mode: "move", start: p, origin: { ...edit.crop }, rect: { ...edit.crop } };
        else drag = { mode: "draw", anchor: p, rect: null };
        try { canvas.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
    });
    canvas.addEventListener("pointermove", (ev) => {
        if (!cropping || !img) return;
        const p = picPoint(ev);
        if (!drag) {
            // idle : show what a drag would do here
            const handle = handleAt(p, edit.crop);
            canvas.style.cursor = handle ? HANDLE_CURSORS[handle] : inside(p, edit.crop) ? "move" : "crosshair";
            return;
        }
        const [tw, th] = pictureSize();
        if (drag.mode === "move") {
            const o = drag.origin;
            const x = Math.round(Math.min(tw - o.width, Math.max(0, o.x + p.x - drag.start.x)));
            const y = Math.round(Math.min(th - o.height, Math.max(0, o.y + p.y - drag.start.y)));
            drag.rect = { ...o, x, y };
        } else if (drag.mode === "resize") {
            drag.rect = resizeRect(drag.handle, drag.origin, p, tw, th, aspect, mult);
        } else {
            drag.rect = dragRect(drag.anchor, p, tw, th, aspect, mult);
        }
        draw();
    });
    const endDrag = (ev) => {
        if (!drag) return;
        try { canvas.releasePointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
        if (ev.type === "pointerup") {
            // a click without a drag clears nothing : the previous crop stays
            if (drag.mode !== "draw" || drag.rect) edit.crop = drag.rect;
        }
        drag = null;
        layout();
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    // ── load ──
    const picture = new Image();
    picture.addEventListener("load", () => {
        img = picture;
        stage.replaceChildren(canvas);
        // an existing crop must fit the picture, else it is dropped
        if (edit.crop) {
            const [tw, th] = pictureSize();
            const c = edit.crop;
            if (c.x + c.width > tw || c.y + c.height > th) edit.crop = null;
        }
        layout();
    });
    picture.addEventListener("error", () => {
        stage.replaceChildren(el("span", { class: "nme-loading" }, "the picture could not be loaded"));
    });
    picture.src = url;

    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", layout);
    drawBar();
    document.body.append(overlay);
    return overlay;
}
