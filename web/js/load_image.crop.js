// CREATED WITH CLAUDE
//
// Crop rectangle on the image preview of the Load Image & Crop node
// (py/load_image.py, class LoadImageAndCrop).
//
// The python node is a plain Load Image - the combo, the upload button, the
// preview and the mask editor all come from the core frontend, untouched - plus
// four hidden widgets holding the rectangle (crop_x / crop_y / crop_width /
// crop_height, in pixels of the loaded image). This module is what makes those
// four widgets editable: it draws the rectangle over the preview and turns
// pointer drags on the image into rectangle edits. A zero width or height is
// "no crop", which is also what the "clear crop" button writes back.
//
// Two frontend-only widgets sit above the preview: "clear crop", and a "crop
// snap" combo constraining the rectangle's width and height to a multiple of
// the chosen value. Snapping is a pure editing aid, so it is kept out of the
// prompt (a serialized widget would re-trigger the node for nothing) and stored
// in node.properties instead, where it still travels with the workflow.
//
// The preview itself is the core "$$canvas-image-preview" widget, which the
// frontend attaches to any node holding images, on its first background draw.
// It is not there when the node is created, so the patch is (re)applied from an
// onDrawBackground override. Note that the core widget defers its drawImage()
// calls to a microtask (a Chrome GPU workaround): anything drawn synchronously
// on top of it ends up *underneath* the image, so the overlay is deferred the
// same way, one microtask later.

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_ID = ADDON_PREFIX + "LoadImageAndCrop";

// the core image preview widget, added by useNodeCanvasImagePreview()
const PREVIEW_WIDGET = "$$canvas-image-preview";

// the backend widgets holding the rectangle
const CROP_X = "crop_x";
const CROP_Y = "crop_y";
const CROP_WIDTH = "crop_width";
const CROP_HEIGHT = "crop_height";

// the frontend-only widgets, and where the snap value is kept between sessions
const SNAP_WIDGET = "crop snap";
const CLEAR_WIDGET = "clear crop";
const PROP_SNAP = "crop_snap";
const SNAP_VALUES = [1, 2, 4, 5, 8, 10, 16, 32, 50, 100];

// overlay metrics, in graph units (the node's own coordinates)
const HANDLE_SIZE = 10;             // drawn size of a resize handle
const HANDLE_GRAB = 5;              // extra grab margin around a handle
const EDGE_HANDLE_MIN_SIDE = 44;    // shorter sides only get their corner handles
const LABEL_HEIGHT = 16;

const COLOR_OUTLINE = "#4aa3ff";
const COLOR_SHADE = "rgba(0, 0, 0, 0.45)";
const COLOR_LABEL_BG = "rgba(0, 0, 0, 0.75)";
const COLOR_LABEL_TEXT = "#ffffff";

// the cursor shown for each drag mode
const CURSORS = {
    new: "crosshair",
    move: "move",
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    n: "ns-resize",
    s: "ns-resize",
    w: "ew-resize",
    e: "ew-resize",
};

// -- Helpers ------------------------------------------------------------------

const isLoadImageAndCrop = (node) => node?.comfyClass === NODE_ID;

const getWidget = (node, name) => node?.widgets?.find((w) => w.name === name);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function settingValue(id, fallback) {
    try {
        const value = app.extensionManager?.setting?.get?.(id);
        return value === undefined || value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

// -- Crop rectangle state -----------------------------------------------------

function getSnap(node) {
    const stored = Number(node?.properties?.[PROP_SNAP]);
    return SNAP_VALUES.includes(stored) ? stored : SNAP_VALUES[0];
}

function getCrop(node) {
    const number = (name) => {
        const value = Number(getWidget(node, name)?.value);
        return isFinite(value) ? Math.round(value) : 0;
    };
    return {
        x: number(CROP_X),
        y: number(CROP_Y),
        width: number(CROP_WIDTH),
        height: number(CROP_HEIGHT),
    };
}

function setCrop(node, rect) {
    const write = (name, value) => {
        const widget = getWidget(node, name);
        if (widget && widget.value !== value) widget.value = value;
    };
    write(CROP_X, rect.x);
    write(CROP_Y, rect.y);
    write(CROP_WIDTH, rect.width);
    write(CROP_HEIGHT, rect.height);
}

// Keep the stored rectangle inside the image it is drawn on: a workflow reloaded
// against a smaller image, or a mask editor round trip, must not leave a
// rectangle hanging outside. A degenerate rectangle collapses to "no crop".
function clampCrop(rect, imageWidth, imageHeight) {
    const x = clamp(rect.x, 0, imageWidth);
    const y = clamp(rect.y, 0, imageHeight);
    const width = clamp(rect.width, 0, imageWidth - x);
    const height = clamp(rect.height, 0, imageHeight - y);
    if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
    return { x, y, width, height };
}

// The rectangle to draw and edit right now, written back when clamping changed it.
function currentCrop(node, geometry) {
    const stored = getCrop(node);
    const rect = clampCrop(stored, geometry.imageWidth, geometry.imageHeight);
    if (rect.x !== stored.x || rect.y !== stored.y ||
        rect.width !== stored.width || rect.height !== stored.height) {
        setCrop(node, rect);
    }
    return rect;
}

// -- Preview geometry ---------------------------------------------------------

// Where the preview widget draws the image, in node coordinates. This mirrors the
// core renderPreview(): the image is scaled down to fit the widget box (never up)
// and centred in it, with room reserved below for the image size text when that
// setting is on. Returns null whenever there is no single image to crop - a batch
// of frames is drawn as a thumbnail grid, which a rectangle cannot describe.
function previewGeometry(node, widget) {
    if (!widget || node?.flags?.collapsed) return null;
    if (node.imgs?.length !== 1) return null;

    const image = node.imgs[0];
    if (!image?.naturalWidth || !image?.naturalHeight) return null;
    if (!widget.computedHeight) return null;

    const sizeTextHeight = settingValue("Comfy.Node.AllowImageSizeDraw", true) ? 15 : 0;
    const boxWidth = widget.width || node.size[0];
    const boxHeight = widget.computedHeight - sizeTextHeight;
    if (boxWidth <= 0 || boxHeight <= 0) return null;

    const scale = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight, 1);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;

    return {
        x: (boxWidth - width) / 2,
        y: (boxHeight - height) / 2 + widget.y,
        width,
        height,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
    };
}

const isOverImage = (geometry, x, y) =>
    x >= geometry.x && x <= geometry.x + geometry.width &&
    y >= geometry.y && y <= geometry.y + geometry.height;

// image pixels -> node coordinates
function toCanvasRect(geometry, rect) {
    const scaleX = geometry.width / geometry.imageWidth;
    const scaleY = geometry.height / geometry.imageHeight;
    return {
        x: geometry.x + rect.x * scaleX,
        y: geometry.y + rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
    };
}

// node coordinates -> image pixels (unrounded, unclamped)
function toImagePoint(geometry, x, y) {
    return {
        x: (x - geometry.x) * geometry.imageWidth / geometry.width,
        y: (y - geometry.y) * geometry.imageHeight / geometry.height,
    };
}

// -- Handles and hit testing --------------------------------------------------

// The eight resize handles, in node coordinates. The mid-side handles are dropped
// on a side too short to hold them without covering its corners.
function handleRects(geometry, rect) {
    const box = toCanvasRect(geometry, rect);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const right = box.x + box.width;
    const bottom = box.y + box.height;

    const points = [
        { id: "nw", x: box.x, y: box.y },
        { id: "ne", x: right, y: box.y },
        { id: "sw", x: box.x, y: bottom },
        { id: "se", x: right, y: bottom },
    ];
    if (box.width >= EDGE_HANDLE_MIN_SIDE) {
        points.push({ id: "n", x: centerX, y: box.y }, { id: "s", x: centerX, y: bottom });
    }
    if (box.height >= EDGE_HANDLE_MIN_SIDE) {
        points.push({ id: "w", x: box.x, y: centerY }, { id: "e", x: right, y: centerY });
    }

    return points.map((point) => ({
        id: point.id,
        x: point.x - HANDLE_SIZE / 2,
        y: point.y - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
    }));
}

// What a drag started at (x, y) would do: resize from a handle, move the whole
// rectangle, or draw a new one.
function hitMode(geometry, rect, x, y) {
    if (rect.width <= 0 || rect.height <= 0) return "new";

    for (const handle of handleRects(geometry, rect)) {
        if (x >= handle.x - HANDLE_GRAB && x <= handle.x + handle.width + HANDLE_GRAB &&
            y >= handle.y - HANDLE_GRAB && y <= handle.y + handle.height + HANDLE_GRAB) {
            return handle.id;
        }
    }

    const box = toCanvasRect(geometry, rect);
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return "move";

    return "new";
}

// -- Dragging -----------------------------------------------------------------

// One side of the rectangle, rounded to the nearest multiple of the snap value.
// It never grows past the room left between the anchored edge and the image
// border, and never shrinks below a single step - unless there is no room for
// even one, in which case the rectangle collapses (no crop).
function snapSpan(raw, snap, available) {
    if (available < snap) return 0;
    let span = Math.max(snap, Math.round(raw / snap) * snap);
    if (span > available) span = Math.floor(available / snap) * snap;
    return span;
}

// Drawing a new rectangle: `anchor` is where the drag started, `point` where it is now.
function rectFromDrag(anchor, point, snap, imageWidth, imageHeight) {
    const anchorX = clamp(Math.round(anchor.x), 0, imageWidth);
    const anchorY = clamp(Math.round(anchor.y), 0, imageHeight);
    const pointX = clamp(Math.round(point.x), 0, imageWidth);
    const pointY = clamp(Math.round(point.y), 0, imageHeight);

    const goingRight = pointX >= anchorX;
    const goingDown = pointY >= anchorY;
    const width = snapSpan(Math.abs(pointX - anchorX), snap, goingRight ? imageWidth - anchorX : anchorX);
    const height = snapSpan(Math.abs(pointY - anchorY), snap, goingDown ? imageHeight - anchorY : anchorY);
    if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 0, height: 0 };

    return {
        x: goingRight ? anchorX : anchorX - width,
        y: goingDown ? anchorY : anchorY - height,
        width,
        height,
    };
}

// Dragging a handle: the edges it names follow the pointer, the opposite ones stay put.
function rectFromHandle(origin, mode, point, snap, imageWidth, imageHeight) {
    let { x, y, width, height } = origin;

    if (mode.includes("w") || mode.includes("e")) {
        const west = mode.includes("w");
        const anchor = west ? origin.x + origin.width : origin.x;
        const target = clamp(Math.round(point.x), 0, imageWidth);
        width = snapSpan(Math.abs(target - anchor), snap, west ? anchor : imageWidth - anchor);
        x = west ? anchor - width : anchor;
    }
    if (mode.includes("n") || mode.includes("s")) {
        const north = mode.includes("n");
        const anchor = north ? origin.y + origin.height : origin.y;
        const target = clamp(Math.round(point.y), 0, imageHeight);
        height = snapSpan(Math.abs(target - anchor), snap, north ? anchor : imageHeight - anchor);
        y = north ? anchor - height : anchor;
    }

    if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
    return { x, y, width, height };
}

// Moving the whole rectangle: the size is untouched, so no snapping applies.
function rectFromMove(origin, offset, imageWidth, imageHeight) {
    return {
        x: clamp(Math.round(origin.x + offset.x), 0, imageWidth - origin.width),
        y: clamp(Math.round(origin.y + offset.y), 0, imageHeight - origin.height),
        width: origin.width,
        height: origin.height,
    };
}

// Claim the pointer when it went down on the image, and edit the rectangle for as
// long as it is held. Returns false everywhere else on the widget, so the core
// behaviour (dragging the node by its preview) is left alone outside the image.
function startCropDrag(widget, node, pointer, canvas) {
    const geometry = previewGeometry(node, widget);
    if (!geometry) return false;

    const down = pointer.eDown;
    if (!down) return false;
    const downX = down.canvasX - node.pos[0];
    const downY = down.canvasY - node.pos[1];
    if (!isOverImage(geometry, downX, downY)) return false;

    const origin = currentCrop(node, geometry);
    const mode = hitMode(geometry, origin, downX, downY);
    const anchor = toImagePoint(geometry, downX, downY);
    const snap = getSnap(node);
    const { imageWidth, imageHeight } = geometry;

    // A drag on the image is still a click on the node.
    const select = () => canvas?.processSelect?.(node, down);

    pointer.onDragStart = select;
    pointer.onClick = select;

    pointer.onDrag = (event) => {
        const point = toImagePoint(geometry, event.canvasX - node.pos[0], event.canvasY - node.pos[1]);
        let rect;
        if (mode === "new") {
            rect = rectFromDrag(anchor, point, snap, imageWidth, imageHeight);
        } else if (mode === "move") {
            rect = rectFromMove(origin, { x: point.x - anchor.x, y: point.y - anchor.y }, imageWidth, imageHeight);
        } else {
            rect = rectFromHandle(origin, mode, point, snap, imageWidth, imageHeight);
        }
        setCrop(node, rect);
        node.setDirtyCanvas(true, true);
    };

    return true;
}

// -- Drawing ------------------------------------------------------------------

function drawOverlay(ctx, widget) {
    const node = widget.node;
    const geometry = previewGeometry(node, widget);
    if (!geometry) return;

    const rect = currentCrop(node, geometry);
    if (rect.width <= 0 || rect.height <= 0) return;

    const box = toCanvasRect(geometry, rect);
    const right = box.x + box.width;
    const bottom = box.y + box.height;

    // dim what the crop leaves out
    ctx.fillStyle = COLOR_SHADE;
    ctx.fillRect(geometry.x, geometry.y, geometry.width, box.y - geometry.y);
    ctx.fillRect(geometry.x, bottom, geometry.width, geometry.y + geometry.height - bottom);
    ctx.fillRect(geometry.x, box.y, box.x - geometry.x, box.height);
    ctx.fillRect(right, box.y, geometry.x + geometry.width - right, box.height);

    ctx.strokeStyle = COLOR_OUTLINE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    ctx.fillStyle = COLOR_OUTLINE;
    for (const handle of handleRects(geometry, rect)) {
        ctx.fillRect(handle.x, handle.y, handle.width, handle.height);
    }

    // the size of the crop, in pixels of the loaded image
    const label = `${rect.width} x ${rect.height}`;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelWidth = ctx.measureText(label).width + 12;
    const labelX = box.x + box.width / 2;
    const labelY = box.y + LABEL_HEIGHT / 2 + 2;
    ctx.fillStyle = COLOR_LABEL_BG;
    ctx.fillRect(labelX - labelWidth / 2, labelY - LABEL_HEIGHT / 2, labelWidth, LABEL_HEIGHT);
    ctx.fillStyle = COLOR_LABEL_TEXT;
    ctx.fillText(label, labelX, labelY);
}

// Tell the user what a drag would do before they start it. The cursor is only
// touched over the image, and put back once the pointer leaves it.
function updateCursor(widget) {
    const canvas = app.canvas;
    const element = canvas?.canvas;
    if (!element) return;

    const node = widget.node;
    const geometry = previewGeometry(node, widget);
    const mouse = canvas.graph_mouse;
    const x = mouse[0] - node.pos[0];
    const y = mouse[1] - node.pos[1];

    if (geometry && !canvas.pointer_is_down && isOverImage(geometry, x, y)) {
        element.style.cursor = CURSORS[hitMode(geometry, currentCrop(node, geometry), x, y)] ?? "crosshair";
        widget.__ntxCropCursor = true;
    } else if (widget.__ntxCropCursor) {
        element.style.cursor = "";
        widget.__ntxCropCursor = false;
    }
}

// -- Wiring -------------------------------------------------------------------

function patchPreviewWidget(widget) {
    if (!widget || widget.__ntxCropPatched) return;
    widget.__ntxCropPatched = true;

    const drawWidget = widget.drawWidget;
    widget.drawWidget = function (ctx, options) {
        drawWidget.call(this, ctx, options);
        try {
            updateCursor(this);
        } catch (error) {
            console.error(`[${NODE_ID}] cursor update failed`, error);
        }
        // The image itself is drawn from a microtask the call above just queued,
        // so the overlay has to wait for one of its own to land on top of it.
        const transform = ctx.getTransform();
        queueMicrotask(() => {
            ctx.save();
            try {
                ctx.setTransform(transform);
                drawOverlay(ctx, this);
            } catch (error) {
                console.error(`[${NODE_ID}] crop overlay failed`, error);
            } finally {
                ctx.restore();
            }
        });
    };

    const onPointerDown = widget.onPointerDown;
    widget.onPointerDown = function (pointer, node, canvas) {
        if (startCropDrag(this, node, pointer, canvas)) return true;
        return onPointerDown ? onPointerDown.call(this, pointer, node, canvas) : false;
    };
}

// The preview widget is created by the core frontend on the node's first
// background draw, once an image has loaded, and dropped again when it has none.
function installPreviewHook(node) {
    const original = node.onDrawBackground;
    node.onDrawBackground = function () {
        const result = original?.apply(this, arguments);
        patchPreviewWidget(getWidget(this, PREVIEW_WIDGET));
        return result;
    };
}

function addCropWidgets(node) {
    node.properties ??= {};

    const clear = node.addWidget("button", CLEAR_WIDGET, null, () => {
        setCrop(node, { x: 0, y: 0, width: 0, height: 0 });
        node.setDirtyCanvas(true, true);
    }, { serialize: false });
    clear.serialize = false;

    const snap = node.addWidget("combo", SNAP_WIDGET, String(getSnap(node)), (value) => {
        node.properties[PROP_SNAP] = Number(value);
    }, { values: SNAP_VALUES.map(String), serialize: false });
    snap.serialize = false;
}

app.registerExtension({
    name: API_PREFIX + ".load_image.crop",

    nodeCreated(node) {
        if (!isLoadImageAndCrop(node)) return;

        addCropWidgets(node);
        installPreviewHook(node);
        node.setSize(node.computeSize());   // make room for the two widgets just added

        // configure() restores properties after this hook, so the snap combo has
        // to be told again what the workflow it was loaded from had picked.
        const original = node.onConfigure;
        node.onConfigure = function () {
            const result = original?.apply(this, arguments);
            const widget = getWidget(this, SNAP_WIDGET);
            if (widget) widget.value = String(getSnap(this));
            return result;
        };
    },
});
