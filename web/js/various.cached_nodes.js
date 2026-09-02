// CREATED WITH CLAUDE

// Debug overlay for ComfyUI's execution cache:
//   - green  : node skipped, its cached output was reused,
//   - orange : node actually executed for this run.
// A node left untinted took no part in the run at all (not reached from the
// queued outputs, muted, bypassed...).
//
// The information comes straight from the backend, no guessing: right before
// the execution loop starts, execution.py probes the output cache for every
// node of the prompt and broadcasts one `execution_cached` message holding the
// full list of skipped node ids. The stock frontend receives it but only uses
// it to advance the progress bar, so nothing is shown on the canvas. The
// orange side comes from the `executing`/`executed` messages, so it fills in
// live as the run progresses.
//
// The tint is painted as an overlay on top of the node while it is drawn, so
// nothing is written to the node itself and nothing can leak into the saved
// workflow. It stays visible after the run ends (that is when it is most
// useful to read) and is cleared when the next run starts. A legend recalling
// what the two colors mean is drawn in the bottom left corner of the canvas
// for as long as there is something tinted.
//
// Toggle it from the empty-canvas RMB menu, under the addon section. Note the
// overlay is drawn on the LiteGraph canvas, so it does not show up in the
// experimental Vue nodes rendering mode, where node bodies are DOM elements
// painted above the canvas.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { ADDON_NAME, API_PREFIX } from "./config.js";
import { registerCanvasMenu } from "./menu.js";

const STORAGE_KEY = API_PREFIX + ".cached_nodes.enabled";

const CACHED = "cached";
const RAN = "ran";

const TINTS = {
    [CACHED]: { fill: "rgba(60, 200, 90, 0.22)", stroke: "rgba(80, 230, 110, 0.85)" },
    [RAN]: { fill: "rgba(230, 145, 40, 0.20)", stroke: "rgba(255, 175, 60, 0.85)" },
};

const LEGEND_ROWS = [
    { state: CACHED, label: "Cached (output reused)" },
    { state: RAN, label: "Executed" },
];

// Legend box, anchored to the bottom left corner of the canvas — the bottom
// right one is where the minimap sits.
const LEGEND_MARGIN = 12;
const LEGEND_PADDING = 10;
const LEGEND_ROW_HEIGHT = 20;
const LEGEND_SWATCH_SIZE = 13;
const LEGEND_SWATCH_GAP = 8;
const LEGEND_PANEL_FILL = "rgba(24, 24, 24, 0.82)";
const LEGEND_PANEL_STROKE = "rgba(255, 255, 255, 0.15)";
const LEGEND_TEXT_COLOR = "#cccccc";
// Swatches are painted over this so they show the tint the way a node shows it.
const LEGEND_SWATCH_BASE = "#353535";

let enabled = localStorage.getItem(STORAGE_KEY) !== "0";

// Execution ids reported by the backend for the current (or last) run. Ids are
// plain node ids at the top level and "<parent id>:<inner id>" chains for nodes
// living inside a subgraph or produced by node expansion.
const cachedIds = new Set();
const ranIds = new Set();

// nodeState() is called for every drawn node on every frame, so its answer is
// memoized and only thrown away when the reported ids change.
const stateByNodeId = new Map();

function invalidate() {
    stateByNodeId.clear();
    app.graph?.setDirtyCanvas(true, true);
}

function redraw() {
    app.graph?.setDirtyCanvas(true, true);
}

// A node drawn on the canvas is not always addressed by a bare id: when the
// user is inside a subgraph the drawn ids are the inner ones while the backend
// reported prefixed chains, and a subgraph node drawn at the top level stands
// for all the inner nodes at once. Match, in order: the exact id, the inner id
// seen from within a subgraph, then the container case — where a single inner
// node having run is enough to paint the whole container orange, since then it
// was not fully reused.
function resolveState(id) {
    if (cachedIds.has(id)) return CACHED;
    if (ranIds.has(id)) return RAN;

    const innerSuffix = ":" + id;
    for (const cached of cachedIds) if (cached.endsWith(innerSuffix)) return CACHED;
    for (const ran of ranIds) if (ran.endsWith(innerSuffix)) return RAN;

    const containerPrefix = id + ":";
    for (const ran of ranIds) if (ran.startsWith(containerPrefix)) return RAN;
    for (const cached of cachedIds) if (cached.startsWith(containerPrefix)) return CACHED;

    return null;
}

function nodeState(node) {
    const id = String(node.id);
    let state = stateByNodeId.get(id);
    if (state === undefined) {
        state = resolveState(id);
        stateByNodeId.set(id, state);
    }
    return state;
}

// ctx is already translated to the node origin: the body starts at (0, 0) and
// the title bar, when there is one, sits just above it.
function paintOverlay(node, ctx, tint) {
    const LiteGraph = window.LiteGraph;
    const titleMode = node.title_mode ?? node.constructor?.title_mode;
    const hasTitle = titleMode !== LiteGraph?.NO_TITLE;
    const titleHeight = hasTitle ? (LiteGraph?.NODE_TITLE_HEIGHT ?? 30) : 0;
    const radius = LiteGraph?.ROUND_RADIUS ?? 8;

    let width;
    let height;
    if (node.flags?.collapsed) {
        width = node._collapsed_width || LiteGraph?.NODE_COLLAPSED_WIDTH || 80;
        height = 0;
    } else {
        const size = node.renderingSize ?? node.size;
        width = size[0];
        height = size[1];
    }

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.roundRect(0, -titleHeight, width, height + titleHeight, radius);
    ctx.fillStyle = tint.fill;
    ctx.fill();
    ctx.strokeStyle = tint.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

// Drawn from onDrawOverlay, which runs after the canvas transform has been
// restored: coordinates are plain CSS pixels, so the legend keeps its size and
// its corner whatever the zoom and panning are.
function drawLegend(ctx) {
    const canvasEl = app.canvas?.canvas;
    if (!canvasEl) return;

    const view = canvasEl.ownerDocument?.defaultView ?? window;
    const viewHeight = canvasEl.height / (view.devicePixelRatio || 1);

    ctx.save();
    ctx.font = `12px ${window.LiteGraph?.DEFAULT_FONT ?? "Arial"}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    let textWidth = 0;
    for (const row of LEGEND_ROWS) {
        textWidth = Math.max(textWidth, ctx.measureText(row.label).width);
    }

    const width = LEGEND_PADDING * 2 + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP + textWidth;
    const height = LEGEND_PADDING * 2 + LEGEND_ROWS.length * LEGEND_ROW_HEIGHT;
    const left = LEGEND_MARGIN;
    const top = viewHeight - LEGEND_MARGIN - height;

    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 6);
    ctx.fillStyle = LEGEND_PANEL_FILL;
    ctx.fill();
    ctx.strokeStyle = LEGEND_PANEL_STROKE;
    ctx.lineWidth = 1;
    ctx.stroke();

    LEGEND_ROWS.forEach((row, index) => {
        const tint = TINTS[row.state];
        const centerY = top + LEGEND_PADDING + index * LEGEND_ROW_HEIGHT + LEGEND_ROW_HEIGHT / 2;
        const swatchX = left + LEGEND_PADDING;
        const swatchY = centerY - LEGEND_SWATCH_SIZE / 2;

        ctx.beginPath();
        ctx.roundRect(swatchX, swatchY, LEGEND_SWATCH_SIZE, LEGEND_SWATCH_SIZE, 3);
        ctx.fillStyle = LEGEND_SWATCH_BASE;
        ctx.fill();
        ctx.fillStyle = tint.fill;
        ctx.fill();
        ctx.strokeStyle = tint.stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = LEGEND_TEXT_COLOR;
        ctx.fillText(row.label, swatchX + LEGEND_SWATCH_SIZE + LEGEND_SWATCH_GAP, centerY);
    });

    ctx.restore();
}

let installed = false;
function installOverlay() {
    const LGraphCanvas = window.LGraphCanvas || app.canvas?.constructor;
    if (installed || !LGraphCanvas?.prototype) return;
    installed = true;

    const origDrawNode = LGraphCanvas.prototype.drawNode;
    LGraphCanvas.prototype.drawNode = function (node, ctx) {
        const result = origDrawNode.apply(this, arguments);
        if (enabled && node && (cachedIds.size || ranIds.size)) {
            const tint = TINTS[nodeState(node)];
            if (tint) {
                try {
                    paintOverlay(node, ctx, tint);
                } catch (err) {
                    console.error(`[${ADDON_NAME}] execution tint overlay failed`, err);
                }
            }
        }
        return result;
    };
}

let legendInstalled = false;
function installLegend() {
    const canvas = app.canvas;
    if (legendInstalled || !canvas) return;
    legendInstalled = true;

    // Chained on the instance so a handler set by another extension — on the
    // instance or on the prototype — keeps running.
    const origDrawOverlay = canvas.onDrawOverlay;
    canvas.onDrawOverlay = function (ctx) {
        const result = origDrawOverlay?.apply(this, arguments);
        if (enabled && (cachedIds.size || ranIds.size)) {
            try {
                drawLegend(ctx);
            } catch (err) {
                console.error(`[${ADDON_NAME}] execution tint legend failed`, err);
            }
        }
        return result;
    };
}

function bindExecutionEvents() {
    // Sent once per run, before anything executes.
    api.addEventListener("execution_start", () => {
        cachedIds.clear();
        ranIds.clear();
        invalidate();
    });

    api.addEventListener("execution_cached", (e) => {
        const nodes = e.detail?.nodes ?? [];
        for (const id of nodes) cachedIds.add(String(id));
        console.log(`[${ADDON_NAME}] cached (skipped) nodes: ${nodes.length}`, nodes);
        invalidate();
    });

    // Ids that did run. `executing` reports the display node id, so expanded
    // nodes are attributed to the node the user sees on the canvas.
    api.addEventListener("executing", (e) => {
        const id = e.detail?.node ?? e.detail;
        if (id !== null && id !== undefined) {
            ranIds.add(String(id));
            invalidate();
        }
    });

    api.addEventListener("executed", (e) => {
        const id = e.detail?.node;
        if (id !== null && id !== undefined) {
            ranIds.add(String(id));
            invalidate();
        }
    });
}

registerCanvasMenu(() => [{
    content: `${enabled ? "☑" : "☐"} Tint cached / executed nodes`,
    callback: () => {
        enabled = !enabled;
        localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
        redraw();
    },
}]);

app.registerExtension({
    name: API_PREFIX + ".cached_nodes",
    // setup() runs once LGraphCanvas exists, so the patch is safe here.
    setup() {
        installOverlay();
        installLegend();
        bindExecutionEvents();
    },
});
