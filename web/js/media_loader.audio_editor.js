// CREATED WITH CLAUDE
//
// Audio editor of the Media Loader node (web/js/media_loader.js).
//
// Like the picture and video editors it never touches the file : it records
// the edits on the slot item, which the node hands out in its NTX_MEDIA_REFS
// bundle for a downstream node to apply. An audio's edit record is
//   { start: seconds, end: seconds | null }
// and keeps only the span from `start` to `end` (null : up to the end).
//
// The interface : the waveform with the kept span and the playhead, a timeline
// under it with the start and end bars, a transport row, and the Reset /
// Accept / Cancel buttons at the bottom.
//
// openAudioEditor(item, url, onApply) shows the modal editor for a slot item ;
// the edits are worked on a copy and only reach the item through Accept.

// the shortest span an audio can be trimmed to, in seconds
const MIN_SPAN = 0.1;
// one step of the step buttons, in seconds
const STEP = 0.1;

// ── Edit records ──────────────────────────────────────────────────────────────

export function defaultAudioEdit() {
    return { start: 0, end: null };
}

// a well formed copy of an audio edit record (anything odd falls back to the default)
export function normalizeAudioEdit(edit) {
    const e = defaultAudioEdit();
    if (!edit || typeof edit !== "object") return e;
    const start = parseFloat(edit.start);
    if (Number.isFinite(start) && start > 0) e.start = round3(start);
    const end = edit.end == null ? null : parseFloat(edit.end);
    if (end != null && Number.isFinite(end) && end > e.start) e.end = round3(end);
    return e;
}

export function isAudioEdited(edit) {
    const e = normalizeAudioEdit(edit);
    return e.start > 0 || e.end != null;
}

// a short description of the edits, for tooltips
export function describeAudioEdit(edit) {
    const e = normalizeAudioEdit(edit);
    return isAudioEdited(e) ? `${fmtTime(e.start)} – ${e.end == null ? "end" : fmtTime(e.end)}` : "";
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// a time as m:ss.t
export function fmtTime(s) {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.nma-overlay {
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
.nma-modal {
    width: min(1000px, 94vw);
    height: min(440px, 92vh);
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
.nma-bar { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.nma-bar .nma-name { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nma-bar .nma-dims { color: #8a93a3; margin-left: 8px; white-space: nowrap; }
.nma-btn {
    border: 1px solid #3a4150;
    border-radius: 4px;
    background: #1e232c;
    color: #c8cfda;
    font-size: 11px;
    padding: 3px 9px;
    cursor: pointer;
    white-space: nowrap;
}
.nma-btn:hover { background: #2a303b; border-color: #59637a; }
.nma-btn:disabled { opacity: .4; cursor: default; }
.nma-btn.on { background: #2b4a7a; border-color: #6f86b8; color: #fff; }
.nma-btn.primary { background: #2b5a3a; border-color: #4c8a5c; }
.nma-btn.primary:hover { background: #357048; }
.nma-btn.danger:hover { background: #7a2e2e; border-color: #a04040; color: #fff; }
.nma-btn.icon { padding: 3px 7px; font-size: 12px; min-width: 30px; }
.nma-stage {
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
.nma-stage canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: pointer; }
.nma-stage .nma-loading { color: #6b7484; }
.nma-timeline { display: block; width: 100%; height: 58px; touch-action: none; cursor: pointer; }
.nma-tlrow { display: flex; justify-content: flex-end; gap: 6px; font-family: ui-monospace, monospace; font-size: 10px; color: #8a93a3; margin-top: -4px; }
.nma-tlrow b { color: #e8c56a; font-weight: normal; }
.nma-transport { display: flex; align-items: center; gap: 6px; }
.nma-transport .nma-group { display: flex; align-items: center; gap: 4px; }
.nma-transport .nma-spacer { flex: 1; }
.nma-transport input {
    width: 58px; background: #0f1116; color: #c8cfda; border: 1px solid #3a4150; border-radius: 4px;
    font-family: ui-monospace, monospace; font-size: 11px; padding: 2px 4px; text-align: right;
}
.nma-transport .nma-kept { color: #8a93a3; font-family: ui-monospace, monospace; }
.nma-foot { display: flex; align-items: center; gap: 6px; }
.nma-foot .nma-spacer { flex: 1; }
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

// the tick spacing giving about ten ticks over a duration
function tickStep(duration) {
    for (const step of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
        if (duration / step <= 10) return step;
    }
    return 600;
}

// the waveform of a decoded buffer as `columns` [min, max] pairs, all channels mixed
function waveformOf(buffer, columns) {
    const peaks = new Array(columns);
    const per = buffer.length / columns;
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    for (let i = 0; i < columns; i++) {
        const from = Math.floor(i * per), to = Math.max(from + 1, Math.floor((i + 1) * per));
        let lo = 1, hi = -1;
        for (const data of channels) {
            for (let j = from; j < to; j++) {
                const v = data[j];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        }
        peaks[i] = [lo, hi];
    }
    return peaks;
}

// ── Editor ────────────────────────────────────────────────────────────────────

// open the editor on a slot item ; onApply(edit) receives the new edit record
// (or null when every edit was removed) when the user accepts
export function openAudioEditor(item, url, onApply) {
    injectCSS();

    let edit = normalizeAudioEdit(item.edit);
    let ready = false;              // metadata loaded
    let peaks = null;               // the waveform, once decoded
    let tlDrag = null;              // an ongoing timeline drag : "start" | "end" | "scrub"
    let raf = 0;

    const audio = el("audio", { src: url, preload: "auto" });
    const wave = el("canvas");
    const wctx = wave.getContext("2d");
    const stage = el("div", { class: "nma-stage" }, el("span", { class: "nma-loading" }, "loading…"));
    const timeline = el("canvas", { class: "nma-timeline" });
    const tctx = timeline.getContext("2d");
    const playheadLabel = el("div", { class: "nma-tlrow" });
    const transport = el("div", { class: "nma-transport" });
    const bar = el("div", { class: "nma-bar" });
    const modal = el("div", { class: "nma-modal" }, bar, stage, timeline, playheadLabel, transport);
    const overlay = el("div", { class: "nma-overlay" }, modal);

    const close = () => {
        audio.pause();
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
    const duration = () => audio.duration || 0;
    const rangeEnd = () => edit.end ?? duration();
    const clampTime = (t) => Math.min(duration(), Math.max(0, t));
    function setStart(t) {
        edit.start = round3(Math.min(Math.max(0, t), rangeEnd() - MIN_SPAN));
        if (audio.currentTime < edit.start) seek(edit.start);
        refresh();
    }
    function setEnd(t) {
        t = Math.max(edit.start + MIN_SPAN, Math.min(duration(), t));
        edit.end = t >= duration() - 0.0005 ? null : round3(t);
        if (audio.currentTime > rangeEnd()) seek(rangeEnd());
        refresh();
    }
    function seek(t) {
        audio.currentTime = clampTime(t);
    }
    function togglePlay() {
        if (audio.paused) {
            if (audio.currentTime >= rangeEnd() - 0.01 || audio.currentTime < edit.start) seek(edit.start);
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
        drawTransport();
    }

    // ── header ──
    function drawBar() {
        fill(bar,
            el("span", { class: "nma-name", title: item.name }, item.name),
            ready ? el("span", { class: "nma-dims" }, fmtTime(duration())) : null,
        );
    }

    // ── footer ──
    modal.append(el("div", { class: "nma-foot" },
        el("button", { class: "nma-btn danger", title: "Delete every edit and restore the whole audio",
            onclick: () => { edit = defaultAudioEdit(); seek(0); layout(); } }, "Reset"),
        el("span", { class: "nma-spacer" }),
        el("button", { class: "nma-btn primary", title: "Keep these edits and close",
            onclick: () => { onApply(isAudioEdited(edit) ? normalizeAudioEdit(edit) : null); close(); } }, "Accept"),
        el("button", { class: "nma-btn", title: "Discard the changes made here and close", onclick: close }, "Cancel"),
    ));

    // size the canvases to the modal and redraw everything
    function layout() {
        drawBar();
        if (!ready) return;
        const dpr = window.devicePixelRatio || 1;
        wave.width = Math.round(wave.clientWidth * dpr);
        wave.height = Math.round(wave.clientHeight * dpr);
        timeline.width = Math.round(timeline.clientWidth * dpr);
        timeline.height = Math.round(timeline.clientHeight * dpr);
        refresh();
    }

    function refresh() {
        drawWave();
        drawTimeline();
        drawTransport();
    }

    // ── waveform ──
    // the waveform spans the same x range as the timeline, so the bars line up
    const TL_PAD = 10;
    function xOf(t, width) { return TL_PAD + (duration() ? t / duration() : 0) * (width - 2 * TL_PAD); }
    function tOf(x, width) { return clampTime((x - TL_PAD) / (width - 2 * TL_PAD) * duration()); }

    function drawWave() {
        const dpr = window.devicePixelRatio || 1;
        const W = wave.clientWidth, H = wave.clientHeight;
        wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        wctx.clearRect(0, 0, W, H);
        const x0 = xOf(0, W), x1 = xOf(duration(), W);
        const xs = xOf(edit.start, W), xe = xOf(rangeEnd(), W);
        // the kept span, lit
        wctx.fillStyle = "#141c26";
        wctx.fillRect(xs, 0, xe - xs, H);
        // the waveform, dimmed outside the span
        const mid = H / 2, amp = H * 0.45;
        if (peaks) {
            const cols = peaks.length;
            for (let i = 0; i < cols; i++) {
                const x = x0 + (x1 - x0) * i / cols;
                const inside = x >= xs && x <= xe;
                wctx.fillStyle = inside ? "#7fb8d8" : "#3a4556";
                const [lo, hi] = peaks[i];
                const top = mid - hi * amp, bottom = mid - lo * amp;
                wctx.fillRect(x, top, Math.max(1, (x1 - x0) / cols), Math.max(1, bottom - top));
            }
        } else {
            wctx.fillStyle = "#6b7484";
            wctx.font = "11px sans-serif";
            wctx.textAlign = "center";
            wctx.fillText("waveform unavailable", W / 2, mid);
        }
        // the midline and the playhead
        wctx.fillStyle = "rgba(200, 207, 218, .18)";
        wctx.fillRect(x0, mid, x1 - x0, 1);
        const xp = xOf(audio.currentTime, W);
        wctx.fillStyle = "#e8c56a";
        wctx.fillRect(xp - 1, 0, 2, H);
    }
    wave.addEventListener("pointerdown", (ev) => {
        if (!ready || ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        seek(tOf(ev.clientX - wave.getBoundingClientRect().left, wave.clientWidth));
        refresh();
    });

    // ── timeline ──
    const TL_TOP = 22;
    const TL_BOTTOM = 52;
    function tlX(t) { return xOf(t, timeline.clientWidth); }

    function drawTimeline() {
        const dpr = window.devicePixelRatio || 1;
        const W = timeline.clientWidth, H = timeline.clientHeight;
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        tctx.clearRect(0, 0, W, H);
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
        tctx.fillStyle = "#141820";
        tctx.fillRect(TL_PAD, TL_TOP, W - 2 * TL_PAD, TL_BOTTOM - TL_TOP);
        const xs = tlX(edit.start), xe = tlX(rangeEnd());
        tctx.fillStyle = "#3d6f85";
        tctx.fillRect(xs, TL_TOP, xe - xs, TL_BOTTOM - TL_TOP);
        tctx.fillStyle = "#7fb8d8";
        for (const x of [xs, xe]) {
            tctx.beginPath();
            tctx.roundRect(x - 4, TL_TOP - 3, 8, TL_BOTTOM - TL_TOP + 6, 3);
            tctx.fill();
        }
        const xp = tlX(audio.currentTime);
        tctx.strokeStyle = "#e8c56a";
        tctx.fillStyle = "#e8c56a";
        tctx.lineWidth = 2;
        tctx.beginPath(); tctx.moveTo(xp, TL_TOP - 8); tctx.lineTo(xp, TL_BOTTOM + 3); tctx.stroke();
        tctx.beginPath(); tctx.moveTo(xp - 5, TL_TOP - 12); tctx.lineTo(xp + 5, TL_TOP - 12); tctx.lineTo(xp, TL_TOP - 6); tctx.closePath(); tctx.fill();
        fill(playheadLabel, "PLAYHEAD ", el("b", {}, fmtTime(audio.currentTime)));
    }

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
        if (tlDrag !== "scrub") audio.pause();
        try { timeline.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
        tlMove(ev);
    });
    function tlMove(ev) {
        const t = tOf(ev.clientX - timeline.getBoundingClientRect().left, timeline.clientWidth);
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
            el("div", { class: "nma-group" },
                el("button", { class: "nma-btn icon", title: `${STEP} s back`, onclick: () => { audio.pause(); seek(audio.currentTime - STEP); } }, "◀▎"),
                el("button", { class: "nma-btn icon", title: audio.paused ? "Play (space)" : "Pause (space)", onclick: togglePlay }, audio.paused ? "▶" : "❚❚"),
                el("button", { class: "nma-btn icon", title: `${STEP} s forward`, onclick: () => { audio.pause(); seek(audio.currentTime + STEP); } }, "▎▶"),
            ),
            el("span", { class: "nma-spacer" }),
            el("div", { class: "nma-group" },
                el("button", { class: "nma-btn", title: "Start the kept span at the playhead", onclick: () => setStart(audio.currentTime) }, "⇤ start"),
                timeInput(edit.start, setStart, "Start of the kept span, in seconds"),
                el("span", {}, "–"),
                timeInput(rangeEnd(), setEnd, "End of the kept span, in seconds"),
                el("button", { class: "nma-btn", title: "End the kept span at the playhead", onclick: () => setEnd(audio.currentTime) }, "end ⇥"),
                el("span", { class: "nma-kept" }, `${kept.toFixed(1)}s kept`),
            ),
            el("span", { class: "nma-spacer" }),
            el("div", { class: "nma-group" },
                el("button", { class: "nma-btn", title: "Go to the start of the kept span", onclick: () => { audio.pause(); seek(edit.start); } }, "⏮ First"),
                el("button", { class: "nma-btn", title: "Go to the end of the kept span", onclick: () => { audio.pause(); seek(rangeEnd()); } }, "Last ⏭"),
            ),
        );
    }

    // ── playback ──
    function tick() {
        if (!audio.paused && !audio.ended) {
            if (audio.currentTime >= rangeEnd()) seek(edit.start);
            drawWave(); drawTimeline();
            raf = requestAnimationFrame(tick);
        }
    }
    audio.addEventListener("play", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); drawTransport(); });
    // animation frames stall in a background tab : the media clock still enforces the span
    audio.addEventListener("timeupdate", () => {
        if (!audio.paused && audio.currentTime >= rangeEnd()) seek(edit.start);
    });
    audio.addEventListener("pause", () => { cancelAnimationFrame(raf); refresh(); });
    audio.addEventListener("seeked", () => { if (audio.paused) refresh(); });
    audio.addEventListener("ended", () => { drawTransport(); });

    // ── load ──
    audio.addEventListener("loadedmetadata", () => {
        ready = true;
        if (edit.end != null && edit.end > duration()) edit.end = null;
        if (edit.start >= rangeEnd()) edit.start = 0;
        stage.replaceChildren(wave);
        seek(edit.start);
        layout();
    });
    audio.addEventListener("error", () => {
        stage.replaceChildren(el("span", { class: "nma-loading" }, "the audio could not be loaded"));
    });

    // decode the file for the waveform, apart from the player
    (async () => {
        try {
            const data = await (await fetch(url)).arrayBuffer();
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const buffer = await actx.decodeAudioData(data);
            peaks = waveformOf(buffer, 1200);
            actx.close?.();
        } catch (err) {
            console.warn("[MediaLoader] waveform unavailable:", err);
            peaks = null;
        }
        if (ready) drawWave();
    })();

    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", layout);
    drawBar();
    document.body.append(overlay);
    return overlay;
}
