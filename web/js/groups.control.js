// CREATED WITH CLAUDE
//
// Group Control — act on whole groups of the graph, picked by name
// (py/groups.py, class GroupControl).
//
// The "groups" combo holds the selection: clicking it opens a checklist of
// every group of the graph the node lives in. Ticking is multi-select and the
// menu stays open until it is dismissed. Four buttons then act on every node
// held by the selected groups:
//   - Mute   : mode NEVER  — the nodes are left out of the prompt,
//   - Bypass : mode BYPASS — the nodes are skipped, their inputs pass through,
//   - Reset  : mode ALWAYS — undoes both,
//   - Queue  : runs ONLY the active output nodes of those groups. It goes
//              through the backend partial execution
//              (partial_execution_targets), so everything feeding them runs and
//              nothing else does — and a broken node elsewhere in the workflow
//              cannot block the run, since only the chosen outputs and their
//              ancestors are validated.
//
// Groups and node modes are pure FRONTEND concepts — the prompt builder drops
// muted / bypassed nodes and the backend never hears of a group — so this is a
// canvas control panel, not a node that executes. It is virtual
// (isVirtualNode): pruned from every prompt, never queued, free.
//
// The selection is stored BY NAME in node.properties.groups, so it survives
// save / reload and copy / paste, and reads plainly in the workflow JSON.
// Renaming a group therefore breaks the link: the stale name keeps its line in
// the picker, flagged "(missing)", so it can be unticked (or the group renamed
// back). A name matching several groups acts on all of them.

import { app } from "../../../scripts/app.js";

import { ADDON_PREFIX, ADDON_NAME, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";

const NODE_ID = ADDON_PREFIX + "GroupControl";
const CATEGORY = ADDON_NAME + "/utils";

const PROP_GROUPS = "groups";       // node.properties.groups = ["group title", ...]
const PROP_BUTTONS = "buttons";     // node.properties.buttons = ["mute", "queue", ...]
const GROUPS_WIDGET = "groups";
const ACTIONS_WIDGET = "actions";

// LiteGraph node modes. BYPASS is an addition of ComfyUI and is missing from
// some LiteGraph builds, so the three are spelled out rather than read from it.
const MODE_ALWAYS = 0;
const MODE_NEVER = 2;
const MODE_BYPASS = 4;

// Checklist markers, same width so ticked and unticked lines keep one indent.
const TICK = "✔ ";
const NO_TICK = "   ";

const MIN_WIDTH = 250;

// Action row: the four buttons are drawn side by side inside one widget row.
// The left / right margin stays inside the 6px the widget hit test allows, so
// every button can be clicked.
const ROW_HEIGHT = LiteGraph.NODE_WIDGET_HEIGHT;
const ROW_MARGIN = 8;
const ROW_GAP = 4;
const ROW_RADIUS = 4;
const ROW_FONT_SIZE = 11;       // shrunk further when a label does not fit
const ROW_FONT_MIN_SIZE = 8;

// Widget stacking, as done by LGraphNode._arrangeWidgets: the first widget sits
// at y = 2 (this node has no slot to push it down) and every widget takes
// computeSize()[1] + 4.
const WIDGETS_START_Y = 2;
const WIDGETS_SPACING = 4;
const WIDGETS_BOTTOM_MARGIN = 4;

// ── Small helpers ─────────────────────────────────────────────────────────────

function toast(severity, summary, detail) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 4000 });
}

function isNode(item) {
    return item instanceof LiteGraph.LGraphNode;
}

function isOutputNode(node) {
    // Same flag the core "Queue Selected Output Nodes" command reads.
    return !!node?.constructor?.nodeData?.output_node;
}

function isActive(node) {
    return node.mode !== MODE_NEVER && node.mode !== MODE_BYPASS;
}

// ── Selection state (node.properties) ─────────────────────────────────────────

function getNames(node) {
    const stored = node.properties?.[PROP_GROUPS];
    return Array.isArray(stored) ? stored.filter((n) => typeof n === "string" && n !== "") : [];
}

function setNames(node, names) {
    node.properties = node.properties || {};
    node.properties[PROP_GROUPS] = [...new Set(names)];
    refreshWidget(node);
    node.setDirtyCanvas(true, true);
}

// Every group of the graph THIS node lives in — inside a subgraph, that is the
// groups of the subgraph, which is the scope the buttons act on.
function graphGroups(node) {
    return node.graph?.groups ?? [];
}

// Unique group titles, in canvas order.
function groupTitles(node) {
    const titles = [];
    for (const group of graphGroups(node)) {
        const title = group.title ?? "";
        if (title !== "" && !titles.includes(title)) titles.push(title);
    }
    return titles;
}

function selectedGroups(node) {
    const names = new Set(getNames(node));
    return graphGroups(node).filter((group) => names.has(group.title));
}

// Every node held by the given groups, deduplicated, minus the control node
// itself. Group membership is positional and only refreshed when the group is
// touched, so it is recomputed here before the children are read.
function nodesOfGroups(groups, exclude) {
    const nodes = new Set();
    for (const group of groups) {
        try {
            group.recomputeInsideNodes();
        } catch (err) {
            console.error(`[${ADDON_NAME}] could not recompute group "${group.title}"`, err);
        }
        for (const item of group.children ?? group.nodes ?? []) {
            if (isNode(item) && item !== exclude) nodes.add(item);
        }
    }
    return [...nodes];
}

// ── Widget label ──────────────────────────────────────────────────────────────

function summary(node) {
    const names = getNames(node);
    if (!names.length) return "click to pick…";
    if (names.length === 1) return names[0];
    const joined = names.join(", ");
    return joined.length <= 28 ? joined : `${names.length} groups`;
}

function refreshWidget(node) {
    const widget = node.widgets?.find((w) => w.name === GROUPS_WIDGET);
    if (widget) widget.value = summary(node);
}

// ── Group picker ──────────────────────────────────────────────────────────────

function pickerLabel(name, ticked, missing) {
    return `${ticked ? TICK : NO_TICK}${name}${missing ? "   (missing)" : ""}`;
}

// Checklist of every group of the graph. Ticking an entry returns true, which
// tells LiteGraph to keep the menu open, so several groups can be ticked in one
// go; the entry relabels itself in place to show its new state.
function openGroupPicker(node, event) {
    const titles = groupTitles(node);
    const selected = new Set(getNames(node));
    const missing = [...selected].filter((name) => !titles.includes(name));

    const items = [];

    if (!titles.length && !missing.length) {
        items.push({ content: "No group in this graph", disabled: true });
    }

    for (const name of [...titles, ...missing]) {
        const gone = !titles.includes(name);
        items.push({
            content: pickerLabel(name, selected.has(name), gone),
            // not an arrow function: `this` is the menu entry element, relabeled
            // in place below so the tick follows the click
            callback: function () {
                const ticked = !selected.has(name);
                if (ticked) selected.add(name);
                else selected.delete(name);
                setNames(node, [...selected]);
                this.textContent = pickerLabel(name, ticked, gone);
                return true;    // keep the menu open
            },
        });
    }

    if (titles.length || missing.length) {
        items.push(null);
        items.push({
            content: "Select all",
            disabled: !titles.length,
            callback: () => setNames(node, titles),
        });
        items.push({
            content: "Select none",
            disabled: !selected.size,
            callback: () => setNames(node, []),
        });
    }

    new LiteGraph.ContextMenu(items, {
        event,
        title: "Groups",
        className: "dark",
        scale: Math.max(1, app.canvas?.ds?.scale ?? 1),
    });
}

// ── Actions ───────────────────────────────────────────────────────────────────

// Resolve the selected groups and the nodes they hold, reporting why there is
// nothing to do when that is the case.
function targets(node, action) {
    if (!node.graph) return null;

    const groups = selectedGroups(node);
    if (!groups.length) {
        const names = getNames(node);
        toast(
            "warn",
            `${action}: no group`,
            names.length
                ? `None of these groups exists in this graph: ${names.join(", ")}`
                : "Pick at least one group first.",
        );
        return null;
    }

    const nodes = nodesOfGroups(groups, node);
    if (!nodes.length) {
        toast("warn", `${action}: nothing to do`, "The selected groups hold no node.");
        return null;
    }
    return { groups, nodes };
}

function applyMode(node, mode, action) {
    const found = targets(node, action);
    if (!found) return;

    const graph = node.graph;
    graph.beforeChange?.();
    for (const target of found.nodes) target.mode = mode;
    graph.afterChange?.();
    app.canvas?.setDirty(true, true);

    toast("info", action, `${found.nodes.length} node(s) in ${found.groups.length} group(s).`);
}

// Where the graph of the node sits in the execution id namespace: "" at the
// root, "<subgraph node id>[:<...>]" inside a subgraph — the same path the core
// frontend builds for its own partial runs.
function executionPrefix(graph) {
    const root = graph.rootGraph ?? app.graph;
    if (graph === root || graph.isRootGraph) return "";

    const findPath = (from) => {
        for (const node of from.nodes ?? []) {
            if (!node.isSubgraphNode?.() || !node.subgraph) continue;
            if (node.subgraph === graph) return String(node.id);
            const deeper = findPath(node.subgraph);
            if (deeper !== undefined) return `${node.id}:${deeper}`;
        }
        return undefined;
    };
    return findPath(root);
}

// Execution ids of every active output node among `nodes`, descending into
// subgraphs — an output node nested in a subgraph is addressed as
// "<subgraph node id>:<its id>", as many levels deep as needed.
function outputExecutionIds(nodes, prefix) {
    const ids = [];
    for (const node of nodes) {
        if (!isActive(node)) continue;      // muted / bypassed: not in the prompt
        const id = prefix ? `${prefix}:${node.id}` : String(node.id);
        if (isOutputNode(node)) ids.push(id);
        if (node.isSubgraphNode?.() && node.subgraph) {
            ids.push(...outputExecutionIds(node.subgraph.nodes ?? [], id));
        }
    }
    return ids;
}

async function queueGroups(node) {
    const found = targets(node, "Queue");
    if (!found) return;

    const prefix = executionPrefix(node.graph);
    if (prefix === undefined) {
        toast("error", "Queue failed", "Could not locate this subgraph in the workflow.");
        return;
    }

    const ids = outputExecutionIds(found.nodes, prefix);
    if (!ids.length) {
        toast("warn", "Queue: nothing to run", "The selected groups hold no active output node.");
        return;
    }

    try {
        // Third argument = partial execution targets: the backend runs these
        // outputs and everything they depend on, and nothing else.
        await app.queuePrompt(0, 1, ids);
    } catch (err) {
        console.error(`[${ADDON_NAME}] queueing groups failed`, err);
        toast("error", "Queue failed", String(err?.message ?? err));
    }
}

// ── Buttons shown on the node ─────────────────────────────────────────────────

// The four actions, in the order they are laid out. Which ones a node actually
// shows is chosen per node from its RMB menu and kept in node.properties.buttons
// (absent = all four); the row splits its width between whichever are left, so
// dropping one widens the others.
const BUTTON_DEFS = [
    { id: "mute", label: "Mute", run: (node) => applyMode(node, MODE_NEVER, "Mute") },
    { id: "bypass", label: "Bypass", run: (node) => applyMode(node, MODE_BYPASS, "Bypass") },
    { id: "reset", label: "Reset", run: (node) => applyMode(node, MODE_ALWAYS, "Reset") },
    { id: "queue", label: "Queue", run: (node) => queueGroups(node) },
];

function getButtons(node) {
    const stored = node.properties?.[PROP_BUTTONS];
    if (!Array.isArray(stored)) return [...BUTTON_DEFS];    // never configured: all four
    // filtered from BUTTON_DEFS, so the layout order never depends on the order
    // the buttons were ticked in
    return BUTTON_DEFS.filter((def) => stored.includes(def.id));
}

function setButtons(node, ids) {
    node.properties = node.properties || {};
    node.properties[PROP_BUTTONS] = BUTTON_DEFS.filter((def) => ids.includes(def.id)).map((def) => def.id);
    refreshButtons(node);
}

// Push the choice onto the row widget and take the height back when no button is
// left — a hidden widget is skipped by the layout, the hit test and the drawing.
function refreshButtons(node) {
    const widget = node.widgets?.find((w) => w.name === ACTIONS_WIDGET);
    if (!widget) return;
    widget.buttons = getButtons(node);
    widget.hidden = widget.buttons.length === 0;
    node.setSize([node.size[0], node.computeSize()[1]]);
    node.setDirtyCanvas(true, true);
}

// Checklist of the four buttons, ticking what the node shows. Same mechanics as
// the group picker: the menu stays open and each line relabels itself.
function openButtonPicker(node, event) {
    const selected = new Set(getButtons(node).map((def) => def.id));

    const items = BUTTON_DEFS.map((def) => ({
        content: pickerLabel(def.label, selected.has(def.id), false),
        callback: function () {
            const shown = !selected.has(def.id);
            if (shown) selected.add(def.id);
            else selected.delete(def.id);
            setButtons(node, [...selected]);
            this.textContent = pickerLabel(def.label, shown, false);
            return true;    // keep the menu open
        },
    }));

    new LiteGraph.ContextMenu(items, {
        event,
        title: "Buttons",
        className: "dark",
        scale: Math.max(1, app.canvas?.ds?.scale ?? 1),
    });
}

// ── Action row widget ─────────────────────────────────────────────────────────

// A widget type LiteGraph does not know stays the plain object it was given:
// addCustomWidget() only converts the types it has a class for, and the canvas
// then honours our own draw() and onPointerDown(). That is what puts four
// buttons on the single row a stock "button" widget would spend on one.

function buttonRects(widget, width) {
    const count = widget.buttons.length;
    if (!count) return [];
    const inner = width - 2 * ROW_MARGIN;
    const buttonWidth = (inner - ROW_GAP * (count - 1)) / count;
    return widget.buttons.map((button, i) => ({
        button,
        x: ROW_MARGIN + i * (buttonWidth + ROW_GAP),
        width: buttonWidth,
    }));
}

// Largest font size at which the label fits its button, so shrinking the node
// squeezes the text instead of overflowing it.
function fitFont(ctx, text, maxWidth) {
    for (let size = ROW_FONT_SIZE; size > ROW_FONT_MIN_SIZE; size--) {
        ctx.font = `${size}px Arial`;
        if (ctx.measureText(text).width <= maxWidth) return;
    }
    ctx.font = `${ROW_FONT_MIN_SIZE}px Arial`;
}

function addButtonRow(node) {
    const widget = {
        type: "ntx_button_row",
        name: ACTIONS_WIDGET,
        value: null,
        serialize: false,
        buttons: getButtons(node),

        // called both with and without a width, hence the fallback
        computeSize(width) {
            return [width ?? node.size[0], ROW_HEIGHT];
        },

        draw(ctx, drawnNode, width, y, height, lowQuality) {
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            for (const rect of buttonRects(this, width)) {
                ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR;
                ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
                ctx.beginPath();
                ctx.roundRect(rect.x, y, rect.width, ROW_HEIGHT, ROW_RADIUS);
                ctx.fill();
                ctx.stroke();
                if (lowQuality) continue;       // zoomed out: shapes only, like every other widget
                ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
                fitFont(ctx, rect.button.label, rect.width - 6);
                ctx.fillText(rect.button.label, rect.x + rect.width / 2, y + ROW_HEIGHT / 2);
            }
            ctx.restore();
        },

        onPointerDown(pointer, clickedNode, canvas) {
            const x = canvas.graph_mouse[0] - clickedNode.pos[0];
            const hit = buttonRects(this, clickedNode.size[0]).find(
                (rect) => x >= rect.x && x <= rect.x + rect.width,
            );
            if (!hit) return false;                                 // in a gap: nothing to do
            pointer.onClick = () => hit.button.run(clickedNode);    // fires on release, like a stock button
            return true;
        },
    };
    return node.addCustomWidget(widget);
}

// ── Node class ────────────────────────────────────────────────────────────────

function registerGroupControlNode() {
    const LGraphNode = LiteGraph.LGraphNode;

    class GroupControlNode extends LGraphNode {
        static title = ADDON_PREFIX + " Group Control";
        static category = CATEGORY;

        constructor(title) {
            super(title);
            // isVirtualNode → pruned from the prompt; this node never executes.
            this.isVirtualNode = true;
            this.serialize_widgets = false;   // the selection lives in properties
            this.comfyClass = NODE_ID;

            this.properties = this.properties || {};
            if (!Array.isArray(this.properties[PROP_GROUPS])) this.properties[PROP_GROUPS] = [];

            // The combo never uses a value list of its own: its click is taken
            // over below to open the checklist instead. The list stays empty, and
            // the ◀ ▶ stepper arrows a combo always draws — nothing to step
            // through, and the click never reaches them — are dropped.
            const groups = this.addWidget("combo", GROUPS_WIDGET, summary(this), () => {}, { values: [] });
            groups.drawArrowButtons = () => {};
            groups.onPointerDown = (pointer, node) => {
                const open = (e) => openGroupPicker(node, e);
                if (pointer) pointer.onClick = open;    // fires on release, like every other widget
                else open();
                return true;                            // click handled
            };

            addButtonRow(this);

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
            // properties are restored after the constructor ran — relabel the combo
            if (!Array.isArray(this.properties?.[PROP_GROUPS])) {
                this.properties = this.properties || {};
                this.properties[PROP_GROUPS] = [];
            }
            refreshWidget(this);
            // the content sets the height, whatever a workflow saved before it
            // was measured this way; the width stays as the user left it
            this.size[0] = Math.max(this.size[0], MIN_WIDTH);
            refreshButtons(this);   // restores the chosen buttons, and the height with them
        }
    }

    LiteGraph.registerNodeType(NODE_ID, GroupControlNode);
}

// ── RMB menu entries (grouped into the addon section by menu.js) ──────────────

registerNodeMenu((node) => {
    if (node?.type !== NODE_ID) return [];
    return [
        {
            content: "Pick groups…",
            callback: (value, options, event) => openGroupPicker(node, event),
        },
        {
            content: "Buttons shown…",
            callback: (value, options, event) => openButtonPicker(node, event),
        },
        {
            content: "Select the nodes of these groups",
            callback: () => {
                const nodes = nodesOfGroups(selectedGroups(node), node);
                const canvas = app.canvas;
                if (!nodes.length || !canvas) return;
                if (canvas.selectNodes) {
                    canvas.selectNodes(nodes);
                } else {
                    canvas.deselectAllNodes?.();
                    for (const target of nodes) canvas.selectNode(target, true);
                }
                canvas.setDirty(true, true);
            },
        },
    ];
});

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".groups.control",
    // registerCustomNodes runs AFTER the backend defs are registered, so this
    // class replaces the one ComfyUI generated from py/groups.py — the library
    // entry (name, category, description) stays, the behavior is ours.
    registerCustomNodes() {
        registerGroupControlNode();
    },
});
