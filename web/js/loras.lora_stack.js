// CREATED WITH CLAUDE SONNET 4.6

import { app } from "../../../scripts/app.js";

import { ADDON_PREFIX, API_PREFIX } from './config.js';
import { registerNodeMenu } from './menu.js';

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.cll-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px 6px;
    box-sizing: border-box;
    width: 100%;
    overflow: hidden;
    font-family: sans-serif;
    font-size: 12px;
}

.cll-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 3px;
    border-radius: 4px;
    min-height: 26px;
}

.cll-row:hover {
    background: rgba(255, 255, 255, 0.05);
}

/* Toggle switch */
.cll-toggle {
    flex: 0 0 30px;
    height: 17px;
    position: relative;
    cursor: pointer;
    display: inline-block;
}

.cll-toggle input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
}

.cll-knob {
    position: absolute;
    inset: 0;
    background: #555;
    border-radius: 17px;
    transition: background 0.15s;
}

.cll-knob::after {
    content: "";
    position: absolute;
    left: 2px;
    top: 2px;
    width: 13px;
    height: 13px;
    background: #bbb;
    border-radius: 50%;
    transition: transform 0.15s;
}

.cll-toggle input:checked ~ .cll-knob {
    background: #4a90d9;
}

.cll-toggle input:checked ~ .cll-knob::after {
    transform: translateX(13px);
}

/* LoRA name combo */
.cll-name {
    flex: 1 1 0;
    min-width: 0;
    width: 0;           /* let flexbox determine width, not content */
    height: 22px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    padding: 0 4px;
    font-size: 11px;
    overflow: hidden;
}

/* Strength label (M / C) */
.cll-lbl {
    flex: 0 0 auto;
    font-size: 10px;
    color: #777;
    user-select: none;
}

/* ── Pill number widget ───────────────────────────────────────────────────── */
.cll-num {
    flex: 0 1 84px;     /* allow shrinking when space is tight */
    min-width: 52px;
    display: flex;
    align-items: center;
    height: 22px;
    background: #2b2b2b;
    border-radius: 11px;
    overflow: hidden;
    user-select: none;
}

.cll-num-arrow {
    flex: 0 0 20px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    color: #666;
    cursor: pointer;
    transition: color 0.1s, background 0.1s;
}

.cll-num-arrow:hover {
    color: #ddd;
    background: rgba(255, 255, 255, 0.08);
}

.cll-num-disp {
    flex: 1;
    text-align: center;
    font-size: 11px;
    color: #ccc;
    cursor: ew-resize;
    white-space: nowrap;
    overflow: hidden;
    line-height: 22px;
}

.cll-num input.cll-num-edit {
    width: 100%;
    background: none;
    border: none;
    outline: none;
    color: #ccc;
    font-size: 11px;
    text-align: center;
    padding: 0;
    cursor: text;
    line-height: 22px;
}

.cll-row.off {
    opacity: 0.45;
}

/* Drag handle */
.cll-drag {
    flex: 0 0 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    cursor: grab;
    font-size: 12px;
    line-height: 1;
    user-select: none;
}

.cll-drag:hover {
    color: #fff;
}

.cll-drag:active {
    cursor: grabbing;
}

.cll-row.cll-dragging {
    opacity: 0.4;
}

/* drop position indicators (set during a drag-over) */
.cll-row.cll-drop-before {
    box-shadow: 0 -2px 0 0 #4a90d9;
}

.cll-row.cll-drop-after {
    box-shadow: 0 2px 0 0 #4a90d9;
}

/* name pill warnings: file missing from the loras folder / duplicate row */
.cll-dd-wrap.cll-missing {
    box-shadow: inset 0 0 0 1px #c05555;
}

.cll-dd-wrap.cll-dup {
    box-shadow: inset 0 0 0 1px #c9a13b;
}

/* Common-strength header row */
.cll-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 3px 5px;
    margin-bottom: 1px;
    border-bottom: 1px solid #333;
}

.cll-header-lbl {
    font-size: 11px;
    color: #999;
    user-select: none;
}

/* Add button */
.cll-add {
    margin-top: 3px;
    padding: 3px 0;
    background: #2a2a2a;
    color: #bbb;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    width: 100%;
    text-align: center;
}

.cll-add:hover {
    background: #3a3a3a;
    color: #eee;
}

/* Context menu */
.cll-ctx-menu {
    position: fixed;
    background: #1e1e1e;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 3px 0;
    z-index: 99999;
    min-width: 130px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.7);
    font-family: sans-serif;
    font-size: 12px;
    color: #ccc;
}

.cll-ctx-item {
    padding: 5px 14px;
    cursor: pointer;
    white-space: nowrap;
}

.cll-ctx-item:hover {
    background: #333;
    color: #fff;
}

.cll-ctx-item.dim {
    color: #555;
    cursor: default;
    pointer-events: none;
}

.cll-ctx-sep {
    height: 1px;
    background: #3a3a3a;
    margin: 3px 0;
}

/* Filterable LoRA name dropdown — pill style matching the number widget */
.cll-dd-wrap {
    flex: 1 1 0;
    min-width: 0;
    width: 0;
    display: flex;
    align-items: center;
    height: 22px;
    background: #2b2b2b;
    border-radius: 11px;
    overflow: hidden;
}

.cll-dd-display {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    line-height: 22px;
    background: transparent;
    color: var(--input-text, #ccc);
    border: none;
    padding: 0 2px;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    box-sizing: border-box;
    text-align: left;
}

.cll-dd-arr {
    flex: 0 0 22px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    color: #666;
    cursor: pointer;
    user-select: none;
    transition: color 0.1s, background 0.1s;
}

.cll-dd-arr:hover {
    color: #ddd;
    background: rgba(255, 255, 255, 0.08);
}

.cll-dd-tree {
    font-size: 11px;
}

.cll-dd-panel {
    position: fixed;
    background: #1e1e1e;
    border: 1px solid #555;
    border-radius: 4px;
    z-index: 99999;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    max-height: 260px;
    font-family: sans-serif;
    font-size: 12px;
}

.cll-dd-filter {
    padding: 5px 7px;
    background: #252525;
    border: none;
    border-bottom: 1px solid #444;
    color: #ccc;
    font-size: 11px;
    outline: none;
    flex: 0 0 auto;
}

.cll-dd-list {
    overflow-y: auto;
    flex: 1 1 auto;
}

.cll-dd-item {
    padding: 4px 10px;
    font-size: 11px;
    color: #ccc;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    outline: none;
}

.cll-dd-item:hover,
.cll-dd-item:focus {
    background: #333;
    color: #fff;
}

.cll-dd-item.selected {
    color: #4a90d9;
}

/* ── Tree selector dialog (SHIFT+click on the lora field) ─────────────────── */
.cll-tree-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
}

.cll-tree-dlg {
    background: #1e1e1e;
    border: 1px solid #555;
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.8);
    width: 440px;
    max-width: 90vw;
    height: 60vh;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    font-family: sans-serif;
    font-size: 12px;
    color: #ccc;
}

.cll-tree-title {
    padding: 8px 12px;
    border-bottom: 1px solid #444;
    color: #ddd;
    user-select: none;
    flex: 0 0 auto;
}

.cll-tree-filter {
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 12px;
    background: #252525;
    border: none;
    border-bottom: 1px solid #444;
    color: #ccc;
    font-size: 11px;
    outline: none;
}

.cll-tree-body {
    flex: 1 1 auto;
    overflow: auto;
    padding: 4px 0;
}

.cll-tree-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
}

.cll-tree-row:hover {
    background: #333;
}

.cll-tree-row.selected {
    background: #2a4a6a;
    color: #fff;
}

.cll-tree-caret {
    flex: 0 0 12px;
    font-size: 9px;
    color: #888;
    text-align: center;
}

.cll-tree-folder-lbl {
    color: #d9b44a;
}

.cll-tree-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid #444;
    flex: 0 0 auto;
}

.cll-tree-btn {
    padding: 4px 16px;
    background: #2a2a2a;
    color: #ccc;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
}

.cll-tree-btn:hover:not(:disabled) {
    background: #3a3a3a;
    color: #fff;
}

.cll-tree-btn.primary {
    background: #2a5a8a;
    border-color: #4a90d9;
}

.cll-tree-btn.primary:hover:not(:disabled) {
    background: #3a6a9a;
}

.cll-tree-btn:disabled {
    opacity: 0.4;
    cursor: default;
}
`;

let _stylesInjected = false;
function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const s = document.createElement("style");
    s.textContent = CSS;
    document.head.appendChild(s);
}

// ── Context menu ──────────────────────────────────────────────────────────────

function openContextMenu(e, items) {
    document.querySelector(".cll-ctx-menu")?.remove();

    const menu = document.createElement("div");
    menu.className = "cll-ctx-menu";
    menu.style.left = e.clientX + "px";
    menu.style.top  = e.clientY + "px";

    for (const item of items) {
        if (item === null) {
            const sep = document.createElement("div");
            sep.className = "cll-ctx-sep";
            menu.appendChild(sep);
        } else {
            const el = document.createElement("div");
            el.className = "cll-ctx-item" + (item.disabled ? " dim" : "");
            el.textContent = item.label;
            if (!item.disabled) {
                el.addEventListener("click", () => { menu.remove(); item.callback(); });
            }
            menu.appendChild(el);
        }
    }

    document.body.appendChild(menu);

    requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        if (r.right  > innerWidth)  menu.style.left = (e.clientX - r.width)  + "px";
        if (r.bottom > innerHeight) menu.style.top  = (e.clientY - r.height) + "px";
    });

    const dismiss = ev => {
        if (!menu.contains(ev.target)) {
            menu.remove();
            document.removeEventListener("pointerdown", dismiss, true);
        }
    };
    setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
}

// ── LoRA list API ─────────────────────────────────────────────────────────────

let _loraCache = null;
let _loraFetch = null;

function fetchLoraList() {
    if (_loraCache) return Promise.resolve(_loraCache);
    if (_loraFetch) return _loraFetch;
    _loraFetch = fetch(`/${API_PREFIX}/get_loras_list`)
        .then(r => {
            if (!r.ok) throw new Error(`get_loras_list HTTP ${r.status}`);
            return r.json();
        })
        .then(list => { _loraCache = ["none", ...list]; return _loraCache; })
        .catch(err => {
            // Don't cache failures — a later render() retries the fetch.
            console.warn("[LoraStack] failed to fetch LoRA list:", err);
            _loraFetch = null;
            return ["none"];
        });
    return _loraFetch;
}

// Force the backend to re-scan the loras folder on disk and replace the cache.
// On failure the previous cache is kept so the UI keeps working with the old list.
function reloadLoraList() {
    const previous = _loraCache;
    _loraFetch = fetch(`/${API_PREFIX}/reload_loras_list`, { method: "POST" })
        .then(r => {
            if (!r.ok) throw new Error(`reload_loras_list HTTP ${r.status}`);
            return r.json();
        })
        .then(list => { _loraCache = ["none", ...list]; return _loraCache; })
        .catch(err => {
            console.warn("[LoraStack] failed to reload LoRA list:", err);
            _loraFetch = null;
            _loraCache = previous;
            return previous ?? ["none"];
        });
    return _loraFetch;
}

// Comparison key for lora names: path-separator and case insensitive, so
// "ILL\\aaa.safetensors" matches "ill/aaa.safetensors".
function normLoraKey(name) {
    return String(name ?? "").replace(/\\/g, "/").toLowerCase();
}

// ── Pill number widget ────────────────────────────────────────────────────────
// Looks like ComfyUI's built-in number widget: [◀  0.70  ▶]
// - Click arrows to step ±0.05
// - Drag the value display left/right to scrub
// - Click the value display (without dragging) to type a number directly:
//   Enter/blur confirms, Escape cancels
// - Hold CTRL while clicking the arrows or scrubbing for fine steps (step / 5)

function makeNumPill(initVal, step, onChange) {
    let value = initVal;

    const pill = document.createElement("div");
    pill.className = "cll-num";

    const dec  = document.createElement("span");
    dec.className = "cll-num-arrow";
    dec.textContent = "◀";

    const disp = document.createElement("span");
    disp.className = "cll-num-disp";
    disp.textContent = value.toFixed(2);

    const inc  = document.createElement("span");
    inc.className = "cll-num-arrow";
    inc.textContent = "▶";

    pill.appendChild(dec);
    pill.appendChild(disp);
    pill.appendChild(inc);

    function snap(v, s = step) {
        // Round to avoid floating-point drift
        return parseFloat((Math.round(v / s) * s).toFixed(6));
    }

    function set(v, s = step) {
        value = snap(v, s);
        disp.textContent = value.toFixed(2);
        onChange(value);
    }

    // Arrow clicks (CTRL = fine step)
    dec.addEventListener("click", e => { e.stopPropagation(); const s = e.ctrlKey ? step / 5 : step; set(value - s, s); });
    inc.addEventListener("click", e => { e.stopPropagation(); const s = e.ctrlKey ? step / 5 : step; set(value + s, s); });

    // Inline text input in place of the value display.
    // Enter (or clicking away) confirms, Escape cancels.
    function startEdit() {
        const inp = document.createElement("input");
        inp.className = "cll-num-edit";
        inp.type = "number";
        inp.value = value;
        inp.step = step;
        disp.replaceWith(inp);
        inp.focus();
        inp.select();

        // the `done` guard keeps a blur fired by the Escape removal (browser
        // dependent) from committing the value after the edit was cancelled
        let done = false;
        const finish = commit => {
            if (done) return;
            done = true;
            if (commit) {
                const v = parseFloat(inp.value);
                if (!isNaN(v)) value = v;
            }
            disp.textContent = value.toFixed(2);
            inp.replaceWith(disp);
            if (commit) onChange(value);
        };

        inp.addEventListener("blur", () => finish(true));
        inp.addEventListener("keydown", ev => {
            if (ev.key === "Enter")  { inp.blur(); }
            if (ev.key === "Escape") { finish(false); }
            ev.stopPropagation();
        });
    }

    // Mouse on the value display: moving past a small threshold scrubs the
    // value; releasing without having moved opens the inline editor instead.
    // Document-level listeners avoid losing capture to the canvas.
    disp.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const startX   = e.clientX;
        const startVal = value;
        let scrubbing  = false;

        const onMove = ev => {
            if (!scrubbing && Math.abs(ev.clientX - startX) < 4) return;
            scrubbing = true;
            const fine = ev.ctrlKey;
            const delta = (ev.clientX - startX) * step * (fine ? 0.08 : 0.4);
            set(startVal + delta, fine ? step / 5 : step);
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup",   onUp);
            if (!scrubbing) startEdit();   // plain click → direct edit
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
    });

    // Allow external reads/writes
    pill.getValue = () => value;
    pill.setValue = v => { value = v; disp.textContent = value.toFixed(2); };

    return pill;
}

// ── Tree selector ─────────────────────────────────────────────────────────────
// SHIFT+click on the lora field opens a modal tree organised by subdirectory
// (e.g. "ILL\\aaa\\bbb.safetensors" → ILL > aaa > bbb.safetensors). Confirm
// with OK or double-click on a lora; dismiss with Cancel / Escape / backdrop.

function buildLoraTree(loraNames) {
    const root = { folders: new Map(), files: [] };
    for (const name of loraNames) {
        if (typeof name !== "string" || !name) continue;
        const parts = name.split(/[\\/]/).filter(p => p !== "");
        if (!parts.length) continue;
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            let child = node.folders.get(parts[i]);
            if (!child) {
                child = { folders: new Map(), files: [] };
                node.folders.set(parts[i], child);
            }
            node = child;
        }
        node.files.push({ label: parts[parts.length - 1], full: name });
    }
    return root;
}

function openTreeSelector(currentName, loraNames, onConfirm) {
    document.querySelector(".cll-tree-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "cll-tree-overlay";

    const dlg = document.createElement("div");
    dlg.className = "cll-tree-dlg";
    overlay.appendChild(dlg);

    const title = document.createElement("div");
    title.className = "cll-tree-title";
    title.textContent = "Select LoRA";
    dlg.appendChild(title);

    const filterInput = document.createElement("input");
    filterInput.className = "cll-tree-filter";
    filterInput.type = "text";
    filterInput.placeholder = "Search…";
    filterInput.setAttribute("autocomplete", "off");
    dlg.appendChild(filterInput);

    const body = document.createElement("div");
    body.className = "cll-tree-body";
    dlg.appendChild(body);

    const btns = document.createElement("div");
    btns.className = "cll-tree-btns";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "cll-tree-btn";
    refreshBtn.textContent = "Refresh";
    refreshBtn.title = "Re-scan the loras folder on disk";

    const spacer = document.createElement("span");
    spacer.style.flex = "1 1 auto";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cll-tree-btn";
    cancelBtn.textContent = "Cancel";

    const okBtn = document.createElement("button");
    okBtn.className = "cll-tree-btn primary";
    okBtn.textContent = "OK";
    okBtn.disabled = true;

    btns.appendChild(refreshBtn);
    btns.appendChild(spacer);
    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    dlg.appendChild(btns);

    let selectedName = null;
    let selectedRow = null;

    function setSelected(row, name) {
        selectedRow?.classList.remove("selected");
        selectedRow = row;
        selectedName = name;
        row.classList.add("selected");
        okBtn.disabled = false;
    }

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    }

    function confirm() {
        if (!selectedName) return;
        const name = selectedName;
        close();
        try { onConfirm(name); }
        catch (err) { console.warn("[LoraStack] tree selection failed:", err); }
    }

    const onKey = e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === "Enter")  { e.preventDefault(); e.stopPropagation(); confirm(); }
    };

    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

    // preselectRow / preselectExpand are captured while rendering so the
    // current lora (if still present in the list) starts selected and visible.
    let preselectRow = null;
    let preselectExpand = null;

    function renderLevel(treeNode, container, depth, ancestors, expandAll, target) {
        const indent = 8 + depth * 14;

        for (const fname of [...treeNode.folders.keys()].sort(collator.compare)) {
            const row = document.createElement("div");
            row.className = "cll-tree-row";
            row.style.paddingLeft = indent + "px";

            const caret = document.createElement("span");
            caret.className = "cll-tree-caret";
            caret.textContent = expandAll ? "▼" : "▶";
            row.appendChild(caret);

            const lbl = document.createElement("span");
            lbl.className = "cll-tree-folder-lbl";
            lbl.textContent = fname;
            row.appendChild(lbl);
            container.appendChild(row);

            const kids = document.createElement("div");
            kids.style.display = expandAll ? "" : "none";
            container.appendChild(kids);

            const expand = () => { kids.style.display = ""; caret.textContent = "▼"; };
            row.addEventListener("click", () => {
                const open = kids.style.display !== "none";
                kids.style.display = open ? "none" : "";
                caret.textContent = open ? "▶" : "▼";
            });

            renderLevel(treeNode.folders.get(fname), kids, depth + 1, [...ancestors, expand], expandAll, target);
        }

        for (const file of [...treeNode.files].sort((a, b) => collator.compare(a.label, b.label))) {
            const row = document.createElement("div");
            row.className = "cll-tree-row";
            row.style.paddingLeft = indent + "px";
            row.title = file.full;

            const caret = document.createElement("span");
            caret.className = "cll-tree-caret";
            row.appendChild(caret);

            const lbl = document.createElement("span");
            lbl.textContent = file.label;
            row.appendChild(lbl);
            container.appendChild(row);

            row.addEventListener("click", () => setSelected(row, file.full));
            row.addEventListener("dblclick", () => { setSelected(row, file.full); confirm(); });

            if (file.full === target && !preselectRow) {
                preselectRow = row;
                preselectExpand = () => ancestors.forEach(fn => fn());
            }
        }
    }

    function rebuild(term) {
        body.innerHTML = "";
        preselectRow = null;
        preselectExpand = null;
        selectedRow = null;

        const lower = term.trim().toLowerCase();
        const names = lower
            ? loraNames.filter(n => typeof n === "string" && n.toLowerCase().includes(lower))
            : loraNames;

        // While filtering, expand everything so matches are visible. Keep the
        // user's pick highlighted if it survived the filter, else fall back to
        // the current lora; if neither is visible, OK stays disabled.
        const target = selectedName ?? currentName;
        renderLevel(buildLoraTree(names), body, 0, [], !!lower, target);

        if (preselectRow) {
            // Guarded so a stale/missing name can't break the dialog — it just
            // opens with nothing selected.
            try {
                preselectExpand?.();
                setSelected(preselectRow, target);
                preselectRow.scrollIntoView({ block: "center" });
            } catch (err) {
                console.warn("[LoraStack] tree preselect failed:", err);
            }
        } else {
            selectedName = null;
            okBtn.disabled = true;
        }
    }

    rebuild("");
    filterInput.addEventListener("input", () => rebuild(filterInput.value));

    refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "Refreshing…";
        const fresh = await reloadLoraList();
        // Mutate the array in place: the flat dropdown behind the dialog holds
        // the same reference, so it picks up the new list as well.
        loraNames.length = 0;
        loraNames.push(...fresh);
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh";
        rebuild(filterInput.value);
        try {
            app.extensionManager?.toast?.add({
                severity: "success",
                summary: "LoRA list reloaded",
                detail: "Re-scanned the loras folder on disk",
                life: 4000,
            });
        } catch { console.log("[LoraStack] LoRA list reloaded"); }
    });
    okBtn.addEventListener("click", confirm);
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("pointerdown", e => {
        if (e.target === overlay) close();   // backdrop click cancels
    });

    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    filterInput.focus();
}

// ── Filterable name combo ─────────────────────────────────────────────────────
// Replaces the plain <select> for LoRA names with a panel that has a live
// filter input so the user can type to narrow a long list.

function makeNameCombo(currentName, loraNames, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "cll-dd-wrap";

    const arrPrev = document.createElement("span");
    arrPrev.className = "cll-dd-arr";
    arrPrev.textContent = "◀";
    wrap.appendChild(arrPrev);

    const display = document.createElement("div");
    display.className = "cll-dd-display";
    display.textContent = currentName || "none";
    display.title = currentName || "none";
    wrap.appendChild(display);

    const arrNext = document.createElement("span");
    arrNext.className = "cll-dd-arr";
    arrNext.textContent = "▶";
    wrap.appendChild(arrNext);

    const treeBtn = document.createElement("span");
    treeBtn.className = "cll-dd-arr cll-dd-tree";
    treeBtn.textContent = "📂";
    treeBtn.title = "Browse the LoRA folder tree (Shift+click the name does the same)";
    wrap.appendChild(treeBtn);

    let panel = null;
    let dismissListener = null;

    function closePanel() {
        panel?.remove();
        panel = null;
        if (dismissListener) {
            document.removeEventListener("pointerdown", dismissListener, true);
            dismissListener = null;
        }
    }

    function selectValue(name) {
        display.textContent = name;
        display.title = name;
        onChange(name);
        closePanel();
    }

    function selectAdjacent(delta) {
        const idx = loraNames.indexOf(display.textContent);
        if (idx === -1) return;
        const next = loraNames[idx + delta];
        if (next !== undefined) selectValue(next);
    }

    arrPrev.addEventListener("click", e => { e.stopPropagation(); selectAdjacent(-1); });
    arrNext.addEventListener("click", e => { e.stopPropagation(); selectAdjacent(+1); });

    function openPanel() {
        if (panel) { closePanel(); return; }

        panel = document.createElement("div");
        panel.className = "cll-dd-panel";

        const filterInput = document.createElement("input");
        filterInput.className = "cll-dd-filter";
        filterInput.placeholder = "Filter…";
        filterInput.type = "text";
        filterInput.setAttribute("autocomplete", "off");
        panel.appendChild(filterInput);

        const list = document.createElement("div");
        list.className = "cll-dd-list";
        panel.appendChild(list);

        function renderList(term) {
            list.innerHTML = "";
            const lower = term.toLowerCase();
            const filtered = lower
                ? loraNames.filter(n => n.toLowerCase().includes(lower))
                : loraNames;

            for (const name of filtered) {
                const item = document.createElement("div");
                item.className = "cll-dd-item" + (name === display.textContent ? " selected" : "");
                item.textContent = name;
                item.tabIndex = -1;

                item.addEventListener("mousedown", e => { e.preventDefault(); selectValue(name); });
                item.addEventListener("keydown", e => {
                    if (e.key === "Enter")     { e.preventDefault(); selectValue(name); }
                    if (e.key === "Escape")    { closePanel(); }
                    if (e.key === "ArrowDown") { e.preventDefault(); (item.nextElementSibling ?? list.firstElementChild)?.focus(); }
                    if (e.key === "ArrowUp")   { e.preventDefault(); item.previousElementSibling ? item.previousElementSibling.focus() : filterInput.focus(); }
                    e.stopPropagation();
                });

                list.appendChild(item);
            }

            list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
        }

        filterInput.addEventListener("input", () => renderList(filterInput.value));
        filterInput.addEventListener("keydown", e => {
            if (e.key === "Escape")    { closePanel(); }
            if (e.key === "ArrowDown") { e.preventDefault(); list.firstElementChild?.focus(); }
            e.stopPropagation();
        });

        renderList("");
        document.body.appendChild(panel);
        list.querySelector(".selected")?.scrollIntoView({ block: "center" });

        const rect = display.getBoundingClientRect();
        panel.style.left  = rect.left + "px";
        panel.style.top   = rect.bottom + "px";
        panel.style.width = Math.max(rect.width, 200) + "px";

        requestAnimationFrame(() => {
            const pr = panel.getBoundingClientRect();
            if (pr.bottom > innerHeight) panel.style.top  = (rect.top - pr.height) + "px";
            if (pr.right  > innerWidth)  panel.style.left = (innerWidth - pr.width - 4) + "px";
        });

        filterInput.focus();

        dismissListener = ev => {
            if (!panel.contains(ev.target) && !wrap.contains(ev.target)) closePanel();
        };
        setTimeout(() => document.addEventListener("pointerdown", dismissListener, true), 0);
    }

    function openTree() {
        closePanel();
        try {
            openTreeSelector(display.textContent, loraNames, selectValue);
        } catch (err) {
            // Fall back to the flat dropdown rather than leaving the user stuck
            console.warn("[LoraStack] tree selector failed, falling back:", err);
            openPanel();
        }
    }

    treeBtn.addEventListener("click", e => { e.stopPropagation(); openTree(); });

    display.addEventListener("click", e => {
        if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            openTree();
            return;
        }
        openPanel();
    });

    wrap.getValue = () => display.textContent;
    wrap.setValue = name => { display.textContent = name; display.title = name; };
    // let the row overwrite the hover tooltip (used for missing/duplicate hints)
    wrap.setTitle = t => { display.title = t; };

    return wrap;
}

// ── Widget factory ────────────────────────────────────────────────────────────

function makeLoraWidget(node, inputName, defaultValue) {
    injectStyles();

    // State — kept as a single object so it serialises atomically
    let state = { commonStrength: false, loras: [] };
    try {
        const parsed = JSON.parse(defaultValue || "[]");
        if (Array.isArray(parsed)) {
            state.loras = parsed;                      // backward-compat
        } else if (parsed && typeof parsed === "object") {
            state = { commonStrength: false, ...parsed };
        }
    } catch { /* leave defaults */ }

    let loraNames = ["none"];

    const wrap = document.createElement("div");
    wrap.className = "cll-wrap";

    // ── Common-strength header ────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "cll-header";

    const hToggleLabel = document.createElement("label");
    hToggleLabel.className = "cll-toggle";
    hToggleLabel.title = "Use model strength for clip as well";

    const hChk = document.createElement("input");
    hChk.type = "checkbox";
    hChk.checked = !!state.commonStrength;

    const hKnob = document.createElement("span");
    hKnob.className = "cll-knob";

    hToggleLabel.appendChild(hChk);
    hToggleLabel.appendChild(hKnob);
    header.appendChild(hToggleLabel);

    const hLbl = document.createElement("span");
    hLbl.className = "cll-header-lbl";
    hLbl.textContent = "Common strength";
    header.appendChild(hLbl);

    hChk.addEventListener("change", () => {
        state.commonStrength = hChk.checked;
        render();
        commit();
    });

    wrap.appendChild(header);

    // ── LoRA rows ─────────────────────────────────────────────────────────────
    const rowsEl = document.createElement("div");
    wrap.appendChild(rowsEl);

    const addBtn = document.createElement("button");
    addBtn.className = "cll-add";
    addBtn.textContent = "+ Add LoRA";
    wrap.appendChild(addBtn);

    // right-click outside a row (header, add button, padding) → stack-level menu
    wrap.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        if (e.target.matches?.("input.cll-num-edit")) return;   // typing a value — no menu
        openContextMenu(e, stackMenuItems());
    });

    function commit() {
        widget.value = JSON.stringify(state);
        app.graph?.setDirtyCanvas(true, true);
    }

    // ── Stack-level actions (bulk toggles, copy/paste as <lora:…> text) ──────

    function toast(severity, summary, detail) {
        try { app.extensionManager?.toast?.add({ severity, summary, detail, life: 4000 }); }
        catch { console.log(`[LoraStack] ${summary}: ${detail}`); }
    }

    function formatLoraAsText(lora) {
        const m = +(lora.modelStrength ?? 1).toFixed(2);
        const c = state.commonStrength ? m : +(lora.clipStrength ?? 1).toFixed(2);
        return m === c ? `<lora:${lora.name}:${m}>` : `<lora:${lora.name}:${m}:${c}>`;
    }

    function copyStackAsText() {
        const rows = state.loras.filter(l => l.enabled && l.name && l.name !== "none");
        if (!rows.length) { toast("warn", "Copy stack", "No enabled LoRAs to copy"); return; }
        const text = rows.map(formatLoraAsText).join("\n");
        const fallback = () => window.prompt("Stack as text (copy manually):", text);
        try {
            navigator.clipboard.writeText(text).then(
                () => toast("success", "Copy stack", `Copied ${rows.length} LoRA${rows.length === 1 ? "" : "s"} to the clipboard`),
                fallback,
            );
        } catch { fallback(); }
    }

    // resolve a pasted name against the known list: exact path match first, then
    // basename match inside subfolders; unknown names are kept as typed (the row
    // will show the missing-file warning)
    function resolvePastedName(name) {
        if (!/\.[^\\/]+$/.test(name)) name += ".safetensors";
        const key = normLoraKey(name);
        return loraNames.find(n => normLoraKey(n) === key)
            ?? loraNames.find(n => normLoraKey(n).endsWith("/" + key))
            ?? name;
    }

    function parseLoraText(text) {
        const out = [];
        const re = /<lora:([^:>]+):([^:>]+?)(?::([^>]+))?>/g;
        let m;
        while ((m = re.exec(text))) {
            const ms = parseFloat(m[2]);
            if (isNaN(ms)) continue;
            const cs = m[3] !== undefined ? parseFloat(m[3]) : NaN;
            out.push({
                enabled: true,
                name: resolvePastedName(m[1].trim()),
                modelStrength: ms,
                clipStrength: isNaN(cs) ? ms : cs,
            });
        }
        return out;
    }

    async function pasteFromText() {
        let text = "";
        try { text = await navigator.clipboard.readText(); } catch { /* denied/unavailable */ }
        if (!/<lora:/i.test(text)) {
            text = window.prompt("Paste <lora:name:strength[:clip]> text:", "") ?? "";
        }
        const entries = parseLoraText(text);
        if (!entries.length) {
            if (text) toast("warn", "Paste LoRAs", "No <lora:…> tags found in the text");
            return;
        }
        state.loras.push(...entries);
        render();
        commit();
        toast("success", "Paste LoRAs", `Added ${entries.length} LoRA${entries.length === 1 ? "" : "s"}`);
    }

    function stackMenuItems() {
        return [
            {
                label: "Enable all",
                disabled: !state.loras.some(l => !l.enabled),
                callback() { state.loras.forEach(l => { l.enabled = true; }); render(); commit(); },
            },
            {
                label: "Disable all",
                disabled: !state.loras.some(l => l.enabled),
                callback() { state.loras.forEach(l => { l.enabled = false; }); render(); commit(); },
            },
            {
                label: "Remove disabled",
                disabled: !state.loras.some(l => !l.enabled),
                callback() { state.loras = state.loras.filter(l => l.enabled); render(); commit(); },
            },
            null,
            { label: "Copy stack as text", disabled: !state.loras.length, callback: copyStackAsText },
            { label: "Paste from text", callback: pasteFromText },
        ];
    }

    // ── Drag reorder ──────────────────────────────────────────────────────────

    // index of the row currently being dragged (null when no drag in progress)
    let dragIndex = null;

    function clearDropMarkers() {
        rowsEl.querySelectorAll(".cll-row").forEach(r =>
            r.classList.remove("cll-drop-before", "cll-drop-after"));
    }

    // move the lora at `from` so it lands at array position `to` (0..length)
    function moveLora(from, to) {
        if (from < 0 || from >= state.loras.length) return;
        const [item] = state.loras.splice(from, 1);
        if (from < to) to -= 1;             // removal shifted later indices down
        to = Math.max(0, Math.min(to, state.loras.length));
        state.loras.splice(to, 0, item);
        render();
        commit();
    }

    function buildRow(lora, idx) {
        const row = document.createElement("div");
        row.className = "cll-row" + (lora.enabled ? "" : " off");

        // ── Drag handle ───────────────────────────────────────────────────────
        const handle = document.createElement("div");
        handle.className = "cll-drag";
        handle.textContent = "⠿";
        handle.title = "Drag to reorder";
        handle.draggable = true;
        handle.addEventListener("dragstart", ev => {
            dragIndex = idx;
            row.classList.add("cll-dragging");
            ev.dataTransfer.effectAllowed = "move";
            // Firefox requires some data to be set for the drag to start
            try { ev.dataTransfer.setData("text/plain", String(idx)); } catch { /* ignore */ }
            try { ev.dataTransfer.setDragImage(row, 0, 0); } catch { /* ignore */ }
        });
        handle.addEventListener("dragend", () => {
            dragIndex = null;
            row.classList.remove("cll-dragging");
            clearDropMarkers();
        });
        row.appendChild(handle);

        // a drop lands relative to whichever row the cursor is over
        row.addEventListener("dragover", ev => {
            if (dragIndex === null) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "move";
            const rect = row.getBoundingClientRect();
            const after = ev.clientY > rect.top + rect.height / 2;
            clearDropMarkers();
            row.classList.add(after ? "cll-drop-after" : "cll-drop-before");
        });
        row.addEventListener("drop", ev => {
            if (dragIndex === null) return;
            ev.preventDefault();
            const rect = row.getBoundingClientRect();
            const after = ev.clientY > rect.top + rect.height / 2;
            const from = dragIndex;
            dragIndex = null;
            clearDropMarkers();
            moveLora(from, after ? idx + 1 : idx);
        });

        // ── Per-lora toggle ───────────────────────────────────────────────────
        const toggleLabel = document.createElement("label");
        toggleLabel.className = "cll-toggle";
        toggleLabel.title = "Toggle LoRA on / off";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!lora.enabled;
        chk.addEventListener("change", () => {
            state.loras[idx].enabled = chk.checked;
            row.classList.toggle("off", !chk.checked);
            commit();
        });

        const knob = document.createElement("span");
        knob.className = "cll-knob";
        toggleLabel.appendChild(chk);
        toggleLabel.appendChild(knob);
        row.appendChild(toggleLabel);

        // ── Name combo ────────────────────────────────────────────────────────
        const names = loraNames.includes(lora.name) || !lora.name
            ? loraNames
            : [lora.name, ...loraNames];

        const combo = makeNameCombo(lora.name || "none", names, name => {
            state.loras[idx].name = name;
            commit();
        });
        row.appendChild(combo);

        // flag rows whose file is missing from the fetched list, or that repeat
        // an earlier row (ApplyLoraStack would silently skip the duplicate)
        if (lora.name && lora.name !== "none") {
            const key = normLoraKey(lora.name);
            const listReady = loraNames.length > 1;   // backend list fetched
            if (listReady && !loraNames.some(n => normLoraKey(n) === key)) {
                combo.classList.add("cll-missing");
                combo.setTitle(`Not found in the loras folder: ${lora.name}`);
            } else if (state.loras.some((l, j) => j < idx && normLoraKey(l.name) === key)) {
                combo.classList.add("cll-dup");
                combo.setTitle(`Duplicate of an earlier row: ${lora.name}`);
            }
        }

        // ── Model strength pill ───────────────────────────────────────────────
        const lblM = document.createElement("span");
        lblM.className = "cll-lbl";
        lblM.textContent = "M";
        row.appendChild(lblM);

        const pillM = makeNumPill(
            lora.modelStrength ?? 1,
            0.05,
            v => { state.loras[idx].modelStrength = v; commit(); },
        );
        pillM.title = "Model strength — click to type, drag to scrub, CTRL for fine steps";
        row.appendChild(pillM);

        // ── Clip strength pill (hidden when commonStrength is on) ─────────────
        const lblC = document.createElement("span");
        lblC.className = "cll-lbl";
        lblC.textContent = "C";

        const pillC = makeNumPill(
            lora.clipStrength ?? 1,
            0.05,
            v => { state.loras[idx].clipStrength = v; commit(); },
        );
        pillC.title = "Clip strength — click to type, drag to scrub, CTRL for fine steps";

        if (!state.commonStrength) {
            row.appendChild(lblC);
            row.appendChild(pillC);
        }

        // ── Right-click context menu ──────────────────────────────────────────
        row.addEventListener("contextmenu", e => {
            if (e.target.matches("input.cll-num-edit")) return;
            e.preventDefault();
            e.stopPropagation();

            const i = idx;
            openContextMenu(e, [
                {
                    label: "Delete",
                    callback() { state.loras.splice(i, 1); render(); commit(); },
                },
                null,
                {
                    label: "Move up",
                    disabled: i === 0,
                    callback() {
                        [state.loras[i - 1], state.loras[i]] = [state.loras[i], state.loras[i - 1]];
                        render(); commit();
                    },
                },
                {
                    label: "Move down",
                    disabled: i === state.loras.length - 1,
                    callback() {
                        [state.loras[i + 1], state.loras[i]] = [state.loras[i], state.loras[i + 1]];
                        render(); commit();
                    },
                },
                null,
                ...stackMenuItems(),
            ]);
        });

        return row;
    }

    function render() {
        hChk.checked = !!state.commonStrength;
        rowsEl.innerHTML = "";
        state.loras.forEach((lora, i) => rowsEl.appendChild(buildRow(lora, i)));
        // After the DOM updates, snap the node to exactly fit its content.
        requestAnimationFrame(() => {
            const h = node.computeSize()[1];
            if (h > 40 && node.size[1] !== h) {
                node.size[1] = h;
                app.graph?.setDirtyCanvas(true, true);
            }
        });
    }

    addBtn.addEventListener("click", () => {
        state.loras.push({ enabled: true, name: "none", modelStrength: 1, clipStrength: 1 });
        render();
        commit();
    });

    const widget = node.addDOMWidget(inputName, "LORA_LIST", wrap, {
        getValue() { return JSON.stringify(state); },
        setValue(v) {
            try {
                const parsed = JSON.parse(v);
                if (Array.isArray(parsed)) {
                    state = { commonStrength: false, loras: parsed };
                } else if (parsed && typeof parsed === "object") {
                    state = { commonStrength: false, ...parsed };
                }
            } catch { state = { commonStrength: false, loras: [] }; }
            render();
        },
    });

    // Override computeSize to always report the full content height.
    // We sum direct child heights instead of using wrap.scrollHeight because
    // ComfyUI sets an explicit style.height on the widget element each draw
    // frame — that makes scrollHeight === clientHeight (the forced value) rather
    // than the actual content height, causing a runaway inflation feedback loop.
    // Child offsetHeights are unaffected by the parent's explicit height.
    // +14: wrap vertical padding (10 px) + flex gap between 3 children (4 px).
    // +14: LiteGraph draw-margin compensation (see original comment above).
    widget.computeSize = function(width) {
        const h = header.offsetHeight + rowsEl.offsetHeight + addBtn.offsetHeight + 14;
        return [width, h + 14];
    };

    // Tag the widget so we can tell it apart from the plain STRING widget the
    // frontend falls back to when the LORA_LIST def patch wasn't applied, and
    // expose render() so the UI can be refreshed externally.
    widget.__isLoraStackUI = true;
    widget.cllRender = render;

    // Node-level hooks are installed once — rebuildLoraUI() may call
    // makeLoraWidget() again on the same node, and re-wrapping would stack.
    if (!node.__cllNodeHooksInstalled) {
        node.__cllNodeHooksInstalled = true;

        // Prevent manual resize from hiding content
        const origOnResize = node.onResize?.bind(node);
        node.onResize = function(size) {
            origOnResize?.apply(this, arguments);
            const minH = node.computeSize()[1];
            if (size[1] < minH) {
                size[1] = minH;   // size IS node.size by reference in LiteGraph
            }
        };

        // After paste/load, snap height to content — the node may arrive with an
        // inflated size from the serialised data before the DOM is laid out.
        const origOnConfigure = node.onConfigure?.bind(node);
        node.onConfigure = function(info) {
            origOnConfigure?.call(this, info);
            requestAnimationFrame(() => {
                const h = node.computeSize()[1];
                if (h > 50 && node.size[1] !== h) {
                    node.size[1] = h;
                    app.graph?.setDirtyCanvas(true, true);
                }
            });
        };
    }

    render();
    fetchLoraList().then(names => { loraNames = names; render(); });

    return widget;
}

// ── UI rebuild ────────────────────────────────────────────────────────────────
// When ComfyUI restores a workflow (e.g. switching back to another workflow
// tab), the node can be re-created from the unpatched Python definition, where
// loras_data is a plain STRING — the user then sees a raw-JSON text widget
// instead of the LoRA list. rebuildLoraUI() replaces whatever widget currently
// holds loras_data with a fresh custom widget, preserving the value.

function rebuildLoraUI(node, force = false) {
    if (!node.widgets) return;
    const idx = node.widgets.findIndex(w => w.name === "loras_data");
    if (idx === -1) return;

    const old = node.widgets[idx];
    if (!force && old.__isLoraStackUI) return;   // already the custom UI

    let value = old.value ?? "[]";
    if (typeof value !== "string") {
        try { value = JSON.stringify(value); } catch { value = "[]"; }
    }

    // Remove the stale widget (and its DOM element, if any)
    try { old.onRemove?.(); } catch { /* ignore */ }
    old.element?.remove?.();
    node.widgets.splice(idx, 1);

    // addDOMWidget appends at the end — move the new widget back to the
    // original slot so widgets_values serialisation order is preserved.
    const widget = makeLoraWidget(node, "loras_data", value);
    const newIdx = node.widgets.indexOf(widget);
    if (newIdx !== -1 && newIdx !== idx) {
        node.widgets.splice(newIdx, 1);
        node.widgets.splice(idx, 0, widget);
    }

    requestAnimationFrame(() => {
        const h = node.computeSize()[1];
        if (h > node.size[1]) node.size[1] = h;
        app.graph?.setDirtyCanvas(true, true);
    });
}

// ── Extension registration ────────────────────────────────────────────────────

const LORA_STACK_NODE_ID = ADDON_PREFIX + "LoraStack"

// RMB entries for LoraStack nodes, grouped into the addon submenu.
registerNodeMenu((node) => {
    if (node?.comfyClass !== LORA_STACK_NODE_ID) return [];
    return [
        {
            content: "Rebuild LoraStack UI",
            callback: () => rebuildLoraUI(node, true),
        },
        {
            content: "Reload Lora List from disk",
            callback: () => {
                reloadLoraList().then(() => {
                    // rebuild so the widget picks up the fresh list immediately
                    rebuildLoraUI(node, true);
                    try {
                        app.extensionManager?.toast?.add({
                            severity: "success",
                            summary: "LoRA list reloaded",
                            detail: "Re-scanned the loras folder on disk",
                            life: 4000,
                        });
                    } catch { console.log("[LoraStack] LoRA list reloaded"); }
                });
            },
        },
    ];
});
app.registerExtension({
	name: API_PREFIX + ".loras.lora_stack",

    // addCustomNodeDefs(defs) {
    //     if (defs[LORA_STACK_NODE_ID]) {
    //         defs[LORA_STACK_NODE_ID].input.required["loras_data"] = [
    //             "LORA_LIST",
    //             { default: "[]" },
    //         ];
    //     }
    // },
    // Patch the loras_data input to the custom widget type. Done here rather
    // than in addCustomNodeDefs because beforeRegisterNodeDef also runs when the
    // frontend re-fetches the definitions after a backend restart (reloadNodeDefs),
    // while addCustomNodeDefs only runs on the initial page load.
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== LORA_STACK_NODE_ID || !nodeData.input) return;
        for (const group of ["required", "optional"]) {
            if (nodeData.input[group]?.["loras_data"]) {
                nodeData.input[group]["loras_data"] = ["LORA_LIST", { default: "[]" }];
            }
        }
    },

    getCustomWidgets() {
        return {
            LORA_LIST(node, inputName, inputData) {
                const widget = makeLoraWidget(
                    node,
                    inputName,
                    inputData[1]?.default ?? "[]",
                );
                return { widget };
            },
        };
    },

    nodeCreated(node) {
        if (node.comfyClass !== LORA_STACK_NODE_ID) return;
        if (node.size[0] < 380) {
            node.setSize([380, node.size[1]]);
        }
    },

    // Called for every node each time a graph is (re)loaded — including when
    // switching back to a workflow tab. Repair the UI if deserialisation
    // produced the raw-JSON fallback widget, or if the custom widget's DOM
    // element never got (re)attached to the document.
    loadedGraphNode(node) {
        if (node.comfyClass !== LORA_STACK_NODE_ID) return;
        rebuildLoraUI(node);
        // DOM widgets mount asynchronously after load; verify shortly after
        // and force a rebuild if the element never attached.
        setTimeout(() => {
            if (node.graph !== app.graph) return;   // tab switched away again
            const w = node.widgets?.find(x => x.name === "loras_data");
            if (!w) return;
            if (!w.__isLoraStackUI || (w.element && !w.element.isConnected)) {
                rebuildLoraUI(node, true);
            } else {
                w.cllRender?.();
            }
        }, 300);
    },
});
