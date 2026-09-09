// CREATED WITH CLAUDE
//
// Group Action Center — buttons playing a list of group actions in order
// (py/groups.py, class GroupActionCenter).
//
// Where GroupControl applies one action to the groups picked in its widget,
// this node holds USER-DEFINED buttons. A button carries a title, an optional
// colour and an ordered list of steps, one step being "<mute | bypass | reset |
// queue> the group named X"; pressing it plays the list from top to bottom. One
// button can therefore mute a stage, reset another and queue the result.
//
// Buttons are created and edited from the node RMB menu, through a form holding
// the title, the colour and the step list (add, remove, drag to reorder). They
// live in node.properties.buttons, so they survive save / reload, travel with a
// copy of the node and read plainly in the workflow JSON.
//
// Like GroupControl the node is VIRTUAL (isVirtualNode): groups and node modes
// are editor notions the server never hears about, so it is a canvas control
// panel, pruned from every prompt, that never executes. The group primitives —
// resolving a name to groups, collecting the nodes they hold, setting a mode,
// queueing their output nodes through the backend partial execution — are the
// ones GroupControl uses, imported from groups.control.js.

import { app } from "../../../scripts/app.js";

import { ADDON_PREFIX, ADDON_NAME, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";
import {
    MODE_BY_ACTION,
    graphGroupTitles,
    groupsNamed,
    nodesOfGroups,
    queueOutputNodes,
    setNodesMode,
} from "./groups.control.js";

const NODE_ID = ADDON_PREFIX + "GroupActionCenter";
const CATEGORY = ADDON_NAME + "/utils";

const PROP_BUTTONS = "buttons";     // node.properties.buttons = [{title, color, actions}]

// The step actions, in the order the dropdown offers them. Everything but
// "queue" sets a node mode, taken from MODE_BY_ACTION.
const ACTIONS = [
    { id: "mute", label: "Mute" },
    { id: "bypass", label: "Bypass" },
    { id: "reset", label: "Reset to normal" },
    { id: "queue", label: "Queue" },
];
const DEFAULT_ACTION = "mute";

function actionLabel(id) {
    return ACTIONS.find((action) => action.id === id)?.label ?? id;
}

// Button row drawing. Same metrics as the GroupControl action row, so the two
// nodes look like the same family.
const ROW_HEIGHT = LiteGraph.NODE_WIDGET_HEIGHT;
const ROW_MARGIN = 8;
const ROW_RADIUS = 4;
const ROW_FONT_SIZE = 12;
const ROW_FONT_MIN_SIZE = 8;
const HINT_FONT = "italic 11px Arial";

const MIN_WIDTH = 220;

// Widget stacking, as done by LGraphNode._arrangeWidgets: the first widget sits
// at y = 2 (this node has no slot to push it down) and every widget takes
// computeSize()[1] + 4.
const WIDGETS_START_Y = 2;
const WIDGETS_SPACING = 4;
const WIDGETS_BOTTOM_MARGIN = 4;

const DEFAULT_COLOR = "#3c6ea5";

// ── Styles (button editor dialog) ─────────────────────────────────────────────

const CSS = `
.gac-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
}

.gac-panel {
    width: 460px;
    max-height: 80vh;
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

.gac-title {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 10px;
}

.gac-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
}

.gac-label {
    flex: 0 0 auto;
    color: #999;
}

.gac-text {
    flex: 1 1 0;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    padding: 0 6px;
    font-size: 12px;
}

.gac-color {
    flex: 0 0 34px;
    height: 24px;
    padding: 1px;
    background: var(--comfy-input-bg, #1a1a1a);
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
}

.gac-color:disabled {
    opacity: 0.35;
    cursor: default;
}

.gac-check {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    cursor: pointer;
    user-select: none;
}

.gac-sub {
    color: #999;
    margin-bottom: 4px;
}

.gac-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    min-height: 28px;
}

.gac-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.gac-row.gac-dragging {
    opacity: 0.4;
}

/* drop position indicators (set during a drag-over) */
.gac-row.gac-drop-before {
    box-shadow: 0 -2px 0 0 #4a90d9;
}

.gac-row.gac-drop-after {
    box-shadow: 0 2px 0 0 #4a90d9;
}

.gac-drag {
    flex: 0 0 16px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    cursor: grab;
    font-size: 14px;
    line-height: 1;
    user-select: none;
}

.gac-drag:hover {
    color: #fff;
}

.gac-drag:active {
    cursor: grabbing;
}

.gac-step {
    flex: 0 0 18px;
    color: #777;
    text-align: right;
}

.gac-group {
    flex: 1 1 0;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    padding: 0 6px;
    font-size: 12px;
}

.gac-action {
    flex: 0 0 130px;
    height: 24px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    font-size: 12px;
}

/* button list rows */
.gac-swatch {
    flex: 0 0 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid #555;
}

.gac-name {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.gac-count {
    flex: 0 0 auto;
    color: #888;
}

.gac-edit {
    flex: 0 0 auto;
    height: 24px;
    padding: 0 10px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
}

.gac-edit:hover {
    border-color: #4a90d9;
    color: #fff;
}

.gac-empty {
    color: #888;
    font-style: italic;
    padding: 4px 2px;
}

.gac-del {
    flex: 0 0 24px;
    height: 24px;
    background: transparent;
    color: #888;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
}

.gac-del:hover {
    color: #e66;
    border-color: #e66;
}

.gac-add {
    margin-top: 8px;
    height: 24px;
    background: transparent;
    color: var(--input-text, #ccc);
    border: 1px dashed #555;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.gac-add:hover {
    border-color: #4a90d9;
    color: #fff;
}

.gac-error {
    color: #e66;
    min-height: 16px;
    margin-top: 6px;
}

.gac-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
}

.gac-btn {
    height: 26px;
    padding: 0 16px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.gac-btn:hover {
    border-color: #4a90d9;
    color: #fff;
}

.gac-btn.gac-ok {
    background: #2a4a6a;
}
`;

function injectCSS() {
    if (document.getElementById("gac-style")) return;
    const style = document.createElement("style");
    style.id = "gac-style";
    style.textContent = CSS;
    document.head.appendChild(style);
}

function toast(severity, summary, detail) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 4000 });
}

// ── Buttons (node.properties) ─────────────────────────────────────────────────

// Read defensively: the workflow JSON can be hand-edited, and a half-valid
// button must not break the drawing.
function normalizeButton(raw) {
    const actions = Array.isArray(raw?.actions) ? raw.actions : [];
    return {
        title: typeof raw?.title === "string" ? raw.title : "",
        color: typeof raw?.color === "string" ? raw.color : null,
        actions: actions
            .filter((step) => step && typeof step.group === "string")
            .map((step) => ({
                group: step.group,
                action: ACTIONS.some((a) => a.id === step.action) ? step.action : DEFAULT_ACTION,
            })),
    };
}

function getButtons(node) {
    const stored = node.properties?.[PROP_BUTTONS];
    return Array.isArray(stored) ? stored.map(normalizeButton) : [];
}

function setButtons(node, buttons) {
    node.properties = node.properties || {};
    node.properties[PROP_BUTTONS] = buttons.map(normalizeButton);
    rebuildWidgets(node);
}

// ── Running a button ──────────────────────────────────────────────────────────

// Play the steps in order. Queue steps are awaited, so a "mute A / queue B"
// button always submits B with A already muted, and two queue steps land in the
// queue in the written order.
async function runButton(node, button) {
    if (!node.graph) return;
    if (node._gacRunning) return;   // a queue step is still in flight

    const name = button.title || "button";
    if (!button.actions.length) {
        toast("warn", name, "This button has no action.");
        return;
    }

    node._gacRunning = true;

    const missing = [];
    let changed = 0;
    let queued = 0;
    let idle = 0;

    try {
        for (const step of button.actions) {
            const groups = groupsNamed(node.graph, [step.group]);
            if (!groups.length) {
                missing.push(step.group);
                continue;
            }

            const nodes = nodesOfGroups(groups, node);
            if (!nodes.length) {
                idle += 1;
                continue;
            }

            if (step.action === "queue") {
                const count = await queueOutputNodes(node.graph, nodes);
                if (count) queued += 1;
                else idle += 1;
            } else {
                setNodesMode(node.graph, nodes, MODE_BY_ACTION[step.action]);
                changed += nodes.length;
            }
        }
    } catch (err) {
        // the steps after a failing one were written to run on it, so the list
        // stops here rather than carrying on with a half-applied state
        console.error(`[${ADDON_NAME}] "${name}" failed`, err);
        toast("error", `${name} failed`, String(err?.message ?? err));
        return;
    } finally {
        node._gacRunning = false;
    }

    const done = [];
    if (changed) done.push(`${changed} node(s) changed`);
    if (queued) done.push(`${queued} run(s) queued`);
    if (idle) done.push(`${idle} step(s) with nothing to do`);

    if (missing.length) {
        toast(
            "warn",
            name,
            `${done.join(", ") || "Nothing done"} — unknown group(s): ${[...new Set(missing)].join(", ")}`,
        );
    } else {
        toast("info", name, done.join(", ") || "Nothing to do.");
    }
}

// ── Button widgets ────────────────────────────────────────────────────────────

// Dark text on a light button, light text on a dark one.
function textColorFor(color) {
    const hex = /^#([0-9a-f]{6})$/i.exec(color ?? "");
    if (!hex) return LiteGraph.WIDGET_TEXT_COLOR;
    const value = parseInt(hex[1], 16);
    const luminance =
        0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
    return luminance > 140 ? "#1a1a1a" : "#f0f0f0";
}

// Largest font size at which the title fits its button.
function fitFont(ctx, text, maxWidth) {
    for (let size = ROW_FONT_SIZE; size > ROW_FONT_MIN_SIZE; size--) {
        ctx.font = `${size}px Arial`;
        if (ctx.measureText(text).width <= maxWidth) return;
    }
    ctx.font = `${ROW_FONT_MIN_SIZE}px Arial`;
}

// A widget type LiteGraph does not know stays the plain object it was given:
// addCustomWidget() only converts the types it has a class for, and the canvas
// then honours our own draw() and onPointerDown().
function addButtonWidget(node, button, index) {
    return node.addCustomWidget({
        type: "ntx_action_button",
        name: `button_${index}`,
        value: null,
        serialize: false,
        button,

        // called both with and without a width, hence the fallback
        computeSize(width) {
            return [width ?? node.size[0], ROW_HEIGHT];
        },

        draw(ctx, drawnNode, width, y, height, lowQuality) {
            const color = this.button.color;
            ctx.save();
            ctx.fillStyle = color ?? LiteGraph.WIDGET_BGCOLOR;
            ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
            ctx.beginPath();
            ctx.roundRect(ROW_MARGIN, y, width - 2 * ROW_MARGIN, ROW_HEIGHT, ROW_RADIUS);
            ctx.fill();
            ctx.stroke();
            if (!lowQuality) {
                const label = this.button.title || "(untitled)";
                ctx.fillStyle = textColorFor(color);
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                fitFont(ctx, label, width - 2 * ROW_MARGIN - 10);
                ctx.fillText(label, width / 2, y + ROW_HEIGHT / 2);
            }
            ctx.restore();
        },

        onPointerDown(pointer, clickedNode) {
            pointer.onClick = () => runButton(clickedNode, this.button);
            return true;    // fires on release, like a stock button
        },
    });
}

// Shown instead of the buttons while there is none, so an empty node says what
// to do with itself. It takes no click: the RMB menu is the way in.
function addHintWidget(node) {
    return node.addCustomWidget({
        type: "ntx_action_hint",
        name: "hint",
        value: null,
        serialize: false,

        computeSize(width) {
            return [width ?? node.size[0], ROW_HEIGHT];
        },

        draw(ctx, drawnNode, width, y, height, lowQuality) {
            if (lowQuality) return;
            ctx.save();
            ctx.fillStyle = LiteGraph.WIDGET_SECONDARY_TEXT_COLOR ?? "#999";
            ctx.font = HINT_FONT;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("right-click → Add button…", width / 2, y + ROW_HEIGHT / 2);
            ctx.restore();
        },

        onPointerDown() {
            return false;
        },
    });
}

// One widget per button, rebuilt whenever the list changes. The node holds no
// other widget, so the list can simply be replaced — and no DOM widget is
// involved, so nothing is left behind.
function rebuildWidgets(node) {
    node.widgets = [];

    const buttons = getButtons(node);
    if (buttons.length) buttons.forEach((button, i) => addButtonWidget(node, button, i));
    else addHintWidget(node);

    node.setSize([Math.max(node.size[0], MIN_WIDTH), node.computeSize()[1]]);
    node.setDirtyCanvas(true, true);
}

// ── Dialog helpers ────────────────────────────────────────────────────────────

// Drag-to-reorder wiring, shared by the two lists (the steps of a button, and
// the buttons of the node): the handle starts the drag, every row shows where a
// drop would land, and `move(from, to)` performs it — `to` being the position
// the item must end up at, counted before its own removal.
function makeDragReorder(rowsEl, move) {
    let dragIndex = null;

    const clearMarkers = () => {
        rowsEl.querySelectorAll(".gac-row").forEach((row) =>
            row.classList.remove("gac-drop-before", "gac-drop-after"));
    };

    const dropsAfter = (row, ev) => {
        const rect = row.getBoundingClientRect();
        return ev.clientY > rect.top + rect.height / 2;
    };

    return function attach(row, handle, i) {
        handle.draggable = true;
        handle.addEventListener("dragstart", (ev) => {
            dragIndex = i;
            row.classList.add("gac-dragging");
            ev.dataTransfer.effectAllowed = "move";
            // Firefox requires some data to be set for the drag to start
            try { ev.dataTransfer.setData("text/plain", String(i)); } catch { /* ignore */ }
            try { ev.dataTransfer.setDragImage(row, 0, 0); } catch { /* ignore */ }
        });
        handle.addEventListener("dragend", () => {
            dragIndex = null;
            row.classList.remove("gac-dragging");
            clearMarkers();
        });

        row.addEventListener("dragover", (ev) => {
            if (dragIndex === null) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "move";
            clearMarkers();
            row.classList.add(dropsAfter(row, ev) ? "gac-drop-after" : "gac-drop-before");
        });
        row.addEventListener("drop", (ev) => {
            if (dragIndex === null) return;
            ev.preventDefault();
            const after = dropsAfter(row, ev);
            const from = dragIndex;
            dragIndex = null;
            clearMarkers();
            move(from, after ? i + 1 : i);
        });
    };
}

// Move `list[from]` so it lands at position `to` (0..length), counted before
// the item is taken out.
function moveInList(list, from, to) {
    if (from < 0 || from >= list.length) return;
    const [item] = list.splice(from, 1);
    if (from < to) to -= 1;             // removal shifted later indices down
    list.splice(Math.max(0, Math.min(to, list.length)), 0, item);
}

function makeDragHandle() {
    const handle = document.createElement("div");
    handle.className = "gac-drag";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    return handle;
}

// ── Button editor (one button) ────────────────────────────────────────────────

// Edits a single button. `source` is the button to start from (null for a new
// one) and `onApply` receives the finished button — the caller decides whether
// it lands on the node or in a list being edited. `onClose` always runs.
function openButtonForm(node, source, heading, onApply, onClose) {
    injectCSS();

    // working copy, edited in place by the rows and dropped on Cancel
    const work = {
        title: source?.title ?? "",
        color: source?.color ?? null,
        actions: (source?.actions ?? []).map((step) => ({ ...step })),
    };

    const overlay = document.createElement("div");
    overlay.className = "gac-overlay";

    const panel = document.createElement("div");
    panel.className = "gac-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "gac-title";
    title.textContent = heading;
    panel.appendChild(title);

    // title + colour
    const head = document.createElement("div");
    head.className = "gac-head";

    const titleLabel = document.createElement("span");
    titleLabel.className = "gac-label";
    titleLabel.textContent = "Title";

    const titleEl = document.createElement("input");
    titleEl.className = "gac-text";
    titleEl.type = "text";
    titleEl.placeholder = "shown on the button";
    titleEl.value = work.title;
    titleEl.addEventListener("input", () => { work.title = titleEl.value; });

    const colorWrap = document.createElement("label");
    colorWrap.className = "gac-check";
    const colorCheck = document.createElement("input");
    colorCheck.type = "checkbox";
    colorCheck.checked = !!work.color;
    const colorText = document.createElement("span");
    colorText.textContent = "Color";
    colorWrap.append(colorCheck, colorText);

    const colorEl = document.createElement("input");
    colorEl.className = "gac-color";
    colorEl.type = "color";
    colorEl.value = work.color ?? DEFAULT_COLOR;
    colorEl.disabled = !colorCheck.checked;

    colorCheck.addEventListener("change", () => {
        colorEl.disabled = !colorCheck.checked;
        work.color = colorCheck.checked ? colorEl.value : null;
    });
    colorEl.addEventListener("input", () => {
        if (colorCheck.checked) work.color = colorEl.value;
    });

    head.append(titleLabel, titleEl, colorWrap, colorEl);
    panel.appendChild(head);

    const sub = document.createElement("div");
    sub.className = "gac-sub";
    sub.textContent = "Actions, played in this order:";
    panel.appendChild(sub);

    // A step can only target a group that exists: the rows offer exactly the
    // groups of the graph the node lives in, and a stored name that no longer
    // matches one (the group was renamed or deleted) is dropped as the form
    // opens, leaving the row empty for a new pick.
    const groupNames = graphGroupTitles(node.graph);
    for (const step of work.actions) {
        if (!groupNames.includes(step.group)) step.group = "";
    }

    const rowsEl = document.createElement("div");
    rowsEl.className = "gac-rows";
    panel.appendChild(rowsEl);

    const addBtn = document.createElement("button");
    addBtn.className = "gac-add";
    addBtn.textContent = "+ Add action";
    panel.appendChild(addBtn);

    const errEl = document.createElement("div");
    errEl.className = "gac-error";
    panel.appendChild(errEl);

    const footer = document.createElement("div");
    footer.className = "gac-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "gac-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "gac-btn gac-ok";
    okBtn.textContent = "OK";
    footer.append(cancelBtn, okBtn);
    panel.appendChild(footer);

    const attachDrag = makeDragReorder(rowsEl, (from, to) => {
        moveInList(work.actions, from, to);
        renderRows();
    });

    function buildRow(step, i) {
        const row = document.createElement("div");
        row.className = "gac-row";

        const handle = makeDragHandle();
        attachDrag(row, handle, i);

        const stepEl = document.createElement("div");
        stepEl.className = "gac-step";
        stepEl.textContent = `${i + 1}.`;

        const groupEl = document.createElement("select");
        groupEl.className = "gac-group";
        const noneOpt = document.createElement("option");
        noneOpt.value = "";
        noneOpt.textContent = groupNames.length ? "— pick a group —" : "(no group in this graph)";
        groupEl.appendChild(noneOpt);
        for (const name of groupNames) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            groupEl.appendChild(opt);
        }
        groupEl.value = step.group;     // empty when the stored group is gone
        groupEl.addEventListener("change", () => { step.group = groupEl.value; });

        const actionEl = document.createElement("select");
        actionEl.className = "gac-action";
        for (const action of ACTIONS) {
            const opt = document.createElement("option");
            opt.value = action.id;
            opt.textContent = action.label;
            actionEl.appendChild(opt);
        }
        actionEl.value = step.action;
        actionEl.addEventListener("change", () => { step.action = actionEl.value; });

        const delBtn = document.createElement("button");
        delBtn.className = "gac-del";
        delBtn.textContent = "✕";
        delBtn.title = "Remove action";
        delBtn.addEventListener("click", () => {
            work.actions.splice(i, 1);
            renderRows();
        });

        row.append(handle, stepEl, groupEl, actionEl, delBtn);
        return row;
    }

    function renderRows(focusLast = false) {
        rowsEl.innerHTML = "";
        work.actions.forEach((step, i) => rowsEl.appendChild(buildRow(step, i)));
        if (focusLast) rowsEl.querySelector(".gac-row:last-child .gac-group")?.focus();
    }

    function validate() {
        if (!work.title.trim()) return "The button needs a title.";
        if (!work.actions.length) return "Add at least one action.";
        if (work.actions.some((step) => !step.group.trim())) return "Every action needs a group.";
        return null;
    }

    function close() {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        onClose?.();
    }

    function apply() {
        const error = validate();
        if (error) {
            errEl.textContent = error;
            return;
        }

        // handed over before close(), so a caller reopening its own dialog from
        // onClose already sees the new button
        onApply({
            title: work.title.trim(),
            color: work.color,
            actions: work.actions.map((step) => ({ group: step.group.trim(), action: step.action })),
        });
        close();
    }

    function onKeyDown(ev) {
        if (ev.key === "Escape") { ev.stopPropagation(); close(); }
        else if (ev.key === "Enter" && ev.target?.tagName === "INPUT" && ev.target.type !== "color") {
            apply();
        }
    }

    addBtn.addEventListener("click", () => {
        work.actions.push({ group: "", action: DEFAULT_ACTION });
        renderRows(true);
    });
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", apply);
    document.addEventListener("keydown", onKeyDown, true);

    renderRows();
    document.body.appendChild(overlay);
    titleEl.focus();
}

// ── Buttons manager (the whole list) ──────────────────────────────────────────

// What a row shows about a button when its steps are not spelled out.
function actionsSummary(button) {
    return button.actions.map((step, i) => `${i + 1}. ${actionLabel(step.action)} — ${step.group}`).join("\n");
}

// The list of the buttons of the node: reorder by dragging, remove, and open the
// editor on any of them. Nothing touches the node until OK, so Cancel really
// undoes the whole session — edits made in the editor included.
function openButtonsManager(node) {
    injectCSS();

    // working copy; the editor writes into it, not into the node
    const work = getButtons(node);

    const overlay = document.createElement("div");
    overlay.className = "gac-overlay";

    const panel = document.createElement("div");
    panel.className = "gac-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "gac-title";
    title.textContent = `${node.title || node.type} — buttons`;
    panel.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "gac-sub";
    sub.textContent = "Shown on the node in this order:";
    panel.appendChild(sub);

    const rowsEl = document.createElement("div");
    rowsEl.className = "gac-rows";
    panel.appendChild(rowsEl);

    const addBtn = document.createElement("button");
    addBtn.className = "gac-add";
    addBtn.textContent = "+ Add button";
    panel.appendChild(addBtn);

    const footer = document.createElement("div");
    footer.className = "gac-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "gac-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "gac-btn gac-ok";
    okBtn.textContent = "OK";
    footer.append(cancelBtn, okBtn);
    panel.appendChild(footer);

    // while the editor is open on top, this dialog keeps still: it must not
    // close on the Escape that dismisses the child
    let editorOpen = false;

    const attachDrag = makeDragReorder(rowsEl, (from, to) => {
        moveInList(work, from, to);
        renderRows();
    });

    function openEditor(index) {
        if (editorOpen) return;
        editorOpen = true;
        const isNew = index === null;
        openButtonForm(
            node,
            isNew ? null : work[index],
            isNew ? "Add button" : `Edit button #${index + 1}`,
            (button) => {
                if (isNew) work.push(button);
                else work[index] = button;
            },
            () => {
                editorOpen = false;
                renderRows();
            },
        );
    }

    function buildRow(button, i) {
        const row = document.createElement("div");
        row.className = "gac-row";

        const handle = makeDragHandle();
        attachDrag(row, handle, i);

        const swatch = document.createElement("div");
        swatch.className = "gac-swatch";
        swatch.style.background = button.color ?? "transparent";
        swatch.title = button.color ? `Color ${button.color}` : "No color";

        const nameEl = document.createElement("div");
        nameEl.className = "gac-name";
        nameEl.textContent = button.title || "(untitled)";

        const countEl = document.createElement("div");
        countEl.className = "gac-count";
        countEl.textContent = `${button.actions.length} action(s)`;
        countEl.title = actionsSummary(button);

        const editBtn = document.createElement("button");
        editBtn.className = "gac-edit";
        editBtn.textContent = "Edit…";
        editBtn.addEventListener("click", () => openEditor(i));

        const delBtn = document.createElement("button");
        delBtn.className = "gac-del";
        delBtn.textContent = "✕";
        delBtn.title = "Remove button";
        delBtn.addEventListener("click", () => {
            work.splice(i, 1);
            renderRows();
        });

        row.append(handle, swatch, nameEl, countEl, editBtn, delBtn);
        return row;
    }

    function renderRows() {
        rowsEl.innerHTML = "";
        if (!work.length) {
            const empty = document.createElement("div");
            empty.className = "gac-empty";
            empty.textContent = "No button yet.";
            rowsEl.appendChild(empty);
            return;
        }
        work.forEach((button, i) => rowsEl.appendChild(buildRow(button, i)));
    }

    function close() {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
    }

    function onKeyDown(ev) {
        if (editorOpen) return;     // the editor on top owns the keyboard
        if (ev.key === "Escape") { ev.stopPropagation(); close(); }
    }

    addBtn.addEventListener("click", () => openEditor(null));
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", () => {
        setButtons(node, work);
        close();
    });
    document.addEventListener("keydown", onKeyDown, true);

    renderRows();
    document.body.appendChild(overlay);
}

// ── Node class ────────────────────────────────────────────────────────────────

function registerGroupActionCenterNode() {
    const LGraphNode = LiteGraph.LGraphNode;

    class GroupActionCenterNode extends LGraphNode {
        static title = ADDON_PREFIX + " Group Action Center";
        static category = CATEGORY;

        constructor(title) {
            super(title);
            // isVirtualNode → pruned from the prompt; this node never executes.
            this.isVirtualNode = true;
            this.serialize_widgets = false;   // the buttons live in properties
            this.comfyClass = NODE_ID;

            this.properties = this.properties || {};
            if (!Array.isArray(this.properties[PROP_BUTTONS])) this.properties[PROP_BUTTONS] = [];

            addHintWidget(this);

            const [width, height] = this.computeSize();
            this.setSize([Math.max(width, MIN_WIDTH), height]);
        }

        // The stock computeSize() always reserves one slot row and a generous
        // margin; on a node with no input and no output that is dead space under
        // the last widget. The widgets are the whole content here, so the height
        // is measured from them — the same way _arrangeWidgets stacks them.
        computeSize(out) {
            const size = super.computeSize(out);
            let height = WIDGETS_START_Y;
            for (const widget of this.widgets ?? []) {
                if (widget.hidden) continue;    // skipped by the layout too
                const widgetHeight = widget.computeSize
                    ? widget.computeSize(size[0])[1]
                    : LiteGraph.NODE_WIDGET_HEIGHT;
                height += widgetHeight + WIDGETS_SPACING;
            }
            size[1] = height + WIDGETS_BOTTOM_MARGIN;
            return size;
        }

        onConfigure() {
            // properties are restored after the constructor ran — build the rows
            // the saved buttons need, and the height with them
            if (!Array.isArray(this.properties?.[PROP_BUTTONS])) {
                this.properties = this.properties || {};
                this.properties[PROP_BUTTONS] = [];
            }
            this.size[0] = Math.max(this.size[0], MIN_WIDTH);
            rebuildWidgets(this);
        }
    }

    LiteGraph.registerNodeType(NODE_ID, GroupActionCenterNode);
}

// ── RMB menu entries (grouped into the addon section by menu.js) ──────────────

registerNodeMenu((node) => {
    if (node?.type !== NODE_ID) return [];

    return [
        {
            content: "Add button…",
            // straight to the editor, appended to the node on OK
            callback: () => openButtonForm(node, null, "Add button", (button) => {
                setButtons(node, [...getButtons(node), button]);
            }),
        },
        {
            content: "Edit buttons…",
            callback: () => openButtonsManager(node),
        },
    ];
});

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".groups.action_center",
    // registerCustomNodes runs AFTER the backend defs are registered, so this
    // class replaces the one ComfyUI generated from py/groups.py — the library
    // entry (name, category, description) stays, the behavior is ours.
    registerCustomNodes() {
        registerGroupActionCenterNode();
    },
});
