// CREATED WITH CLAUDE SONNET 4.6

import { app } from "../../../scripts/app.js";

const ADDON_PREFIX = "NTX"
const API_PREFIX = "ntx-sn"

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
        .then(r => r.json())
        .then(list => { _loraCache = ["none", ...list]; return _loraCache; })
        .catch(() => { _loraCache = ["none"]; return _loraCache; });
    return _loraFetch;
}

// ── Pill number widget ────────────────────────────────────────────────────────
// Looks like ComfyUI's built-in number widget: [◀  0.70  ▶]
// - Click arrows to step ±0.05
// - Drag the value display left/right to scrub
// - Double-click the value display to type a number directly

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

    function snap(v) {
        // Round to avoid floating-point drift
        return parseFloat((Math.round(v / step) * step).toFixed(6));
    }

    function set(v) {
        value = snap(v);
        disp.textContent = value.toFixed(2);
        onChange(value);
    }

    // Arrow clicks
    dec.addEventListener("click", e => { e.stopPropagation(); set(value - step); });
    inc.addEventListener("click", e => { e.stopPropagation(); set(value + step); });

    // Double-click → inline text input
    disp.addEventListener("dblclick", e => {
        e.stopPropagation();
        const inp = document.createElement("input");
        inp.className = "cll-num-edit";
        inp.type = "number";
        inp.value = value;
        inp.step = step;
        disp.replaceWith(inp);
        inp.focus();
        inp.select();

        const finish = () => {
            const v = parseFloat(inp.value);
            if (!isNaN(v)) value = v;
            disp.textContent = value.toFixed(2);
            inp.replaceWith(disp);
            onChange(value);
        };

        inp.addEventListener("blur", finish);
        inp.addEventListener("keydown", ev => {
            if (ev.key === "Enter")  { inp.blur(); }
            if (ev.key === "Escape") { inp.replaceWith(disp); }
            ev.stopPropagation();
        });
    });

    // Drag to scrub — document-level listeners avoid losing capture to the canvas
    disp.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const startX   = e.clientX;
        const startVal = value;

        const onMove = ev => {
            const delta = (ev.clientX - startX) * step * 0.4;
            set(startVal + delta);
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup",   onUp);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
    });

    // Allow external reads/writes
    pill.getValue = () => value;
    pill.setValue = v => { value = v; disp.textContent = value.toFixed(2); };

    return pill;
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

    wrap.addEventListener("contextmenu", e => e.preventDefault());

    function commit() {
        widget.value = JSON.stringify(state);
        app.graph?.setDirtyCanvas(true, true);
    }

    function buildRow(lora, idx) {
        const row = document.createElement("div");
        row.className = "cll-row" + (lora.enabled ? "" : " off");

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
        const sel = document.createElement("select");
        sel.className = "cll-name";
        sel.title = lora.name || "none";

        const optionNames = loraNames.includes(lora.name) || !lora.name
            ? loraNames
            : [lora.name, ...loraNames];

        for (const name of optionNames) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            if (name === lora.name) opt.selected = true;
            sel.appendChild(opt);
        }

        sel.addEventListener("change", () => {
            state.loras[idx].name = sel.value;
            sel.title = sel.value;
            commit();
        });
        row.appendChild(sel);

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
        pillM.title = "Model strength";
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
        pillC.title = "Clip strength";

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

    render();
    fetchLoraList().then(names => { loraNames = names; render(); });

    return widget;
}

// ── Extension registration ────────────────────────────────────────────────────

const LORA_STACK_NODE_ID = ADDON_PREFIX + "LoraStack"
app.registerExtension({
	name: API_PREFIX + ".lora_stack",

    addCustomNodeDefs(defs) {
        if (defs[LORA_STACK_NODE_ID]) {
            defs[LORA_STACK_NODE_ID].input.required["loras_data"] = [
                "LORA_LIST",
                { default: "[]" },
            ];
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
});
