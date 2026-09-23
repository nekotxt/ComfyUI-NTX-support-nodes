// CREATED WITH CLAUDE
//
// Picture editor and fast paste for the Load Image & Edit node (py/load_image.py,
// class LoadImageAndEdit).
//
// The node is a plain Load Image: the combo, the upload button, the preview and
// the mask editor all come from the core frontend, untouched. This module adds a
// picture editor on the preview, and replaces what happens when an image is
// *pasted* on it.
//
// ── The editor ───────────────────────────────────────────────────────────────
//
// A pencil icon is drawn in the corner of the image preview; clicking it opens
// the editor of the Media Loader's picture slots (media_loader.editor.js, which
// has no imports of its own and is reused verbatim). It records the same
// rotate / mirror / crop / max size record, kept in the node's hidden
// edit_settings widget so it serializes with the workflow and reaches the
// backend, which applies it to the image *and* to its mask at execution.
//
// The file on disk is never touched, and neither is node.imgs: the preview
// widget reads `options.previewImages ?? node.imgs` at draw time, so handing it
// an edited canvas through that argument shows the edits while node.imgs keeps
// the original. That is what leaves the core mask editor alone - it copies
// node.imgs[i].src into clipspace, so it still paints on the original picture,
// and the edits are applied to the painted mask afterwards, at execution.
//
// The record belongs to the picture it was made on, so it is dropped when the
// image widget moves to another file. The mask editor is the exception: it
// writes a "clipspace-..." derivative of the *same* picture back into the
// widget, same dimensions, so the record is kept across it.
//
// The core paste handler (useNodePaste, installed by the IMAGEUPLOAD widget)
// posts the image to /upload/image with subfolder=pasted, and the server picks a
// free "image (N).png" there by re-reading and re-hashing every file of that
// series, on every single paste. Once input/pasted holds a few hundred images
// that is seconds of disk churn, on the server's event loop, before the pasted
// image appears. The addon's own route does the same job against a hash register
// kept next to the images, so it only ever hashes the incoming one.
//
// ── The paste ────────────────────────────────────────────────────────────────
//
// Only node.pasteFiles is taken over. node.onDragDrop (dropping a file on the
// node) and the "choose file to upload" button keep the core handlers, so they
// keep the core behaviour, destination folder included.
//
// Ordering note: the IMAGEUPLOAD widget is built by addInputs() in the node
// constructor, and nodeCreated runs after it, so node.pasteFiles is already
// installed by the time this module replaces it. If it is not - a frontend that
// moved this around - the node is left strictly alone and keeps core behaviour.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import {
    openEditor, normalizeEdit, isEdited, hasCropSettings, paintEdited, outputSize,
} from "./media_loader.editor.js";

const NODE_ID = ADDON_PREFIX + "LoadImageAndEdit";

// the combo holding the file name, and the route that fills it
const IMAGE_WIDGET = "image";
const UPLOAD_ROUTE = `/${API_PREFIX}/load_image/upload_pasted`;

// the hidden widget holding the edit record, and the core image preview widget
// the editor is hung on (added by useNodeCanvasImagePreview once an image loads)
const EDIT_WIDGET = "edit_settings";
const PREVIEW_WIDGET = "$$canvas-image-preview";

// which picture the record was made on, kept in the node properties : it travels
// with the workflow and stays out of the prompt, like the crop node's snap setting
const PROP_EDIT_IMAGE = "ntx_edit_image";

// the mask editor writes these back into the image widget : a derivative of the
// picture being edited, same dimensions, so the record survives them
const CLIPSPACE_PREFIX = "clipspace-";

// the pencil icon, in node coordinates
const ICON_SIZE = 20;
const ICON_MARGIN = 5;

// the edited preview is rendered at most this big, whatever the picture's size
const PREVIEW_MAX_SIDE = 1024;

const getWidget = (node, name) => node?.widgets?.find((w) => w.name === name);

// a setting of the core frontend, with a fallback when it cannot be read
function settingValue(id, fallback) {
    try {
        const value = app.extensionManager?.setting?.get?.(id);
        return value === undefined || value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

// the base name of a combo value, without its "[input]" annotation and its folders
function baseName(value) {
    const name = String(value ?? "").replace(/\s*\[[^\]]*\]\s*$/, "");
    return name.slice(name.lastIndexOf("/") + 1);
}

// -- Edit record ---------------------------------------------------------------

function readEdit(node) {
    try {
        return normalizeEdit(JSON.parse(getWidget(node, EDIT_WIDGET)?.value || "{}"));
    } catch {
        return normalizeEdit(null);
    }
}

// store the record, or empty the widget when nothing in it is worth keeping
function writeEdit(node, edit) {
    const widget = getWidget(node, EDIT_WIDGET);
    if (!widget) return;

    const keep = edit && (isEdited(edit) || hasCropSettings(edit));
    widget.value = keep ? JSON.stringify(normalizeEdit(edit)) : "";
    node.properties ??= {};
    node.properties[PROP_EDIT_IMAGE] = getWidget(node, IMAGE_WIDGET)?.value ?? "";
    node.__ntxEditedPreview = null;
}

// The record describes one picture, so it is dropped when the image widget moves
// to another one - a crop made on a portrait picture means nothing on the next.
// The mask editor is the exception: it writes a "clipspace-..." derivative of the
// picture being edited back into the widget, with the same dimensions, so the
// record is carried across it and ends up applied to the painted mask as well.
function syncEditToImage(node) {
    node.properties ??= {};
    const current = getWidget(node, IMAGE_WIDGET)?.value ?? "";
    const previous = node.properties[PROP_EDIT_IMAGE];
    if (previous === current) return;

    node.properties[PROP_EDIT_IMAGE] = current;
    if (previous === undefined) return;                             // first sight of the node
    if (baseName(current).startsWith(CLIPSPACE_PREFIX)) return;     // a mask painted on it

    const widget = getWidget(node, EDIT_WIDGET);
    if (widget?.value) {
        widget.value = "";
        node.__ntxEditedPreview = null;
        node.graph?.setDirtyCanvas(true);
    }
}

// -- Edited preview -------------------------------------------------------------

// The edited picture, for the preview widget to draw in place of the original.
// The widget only ever reads naturalWidth / naturalHeight and hands the thing to
// drawImage, so a canvas carrying those two properties does the job - no blob, no
// object URL to revoke, and the result is ready in the very frame it is asked for.
// The two properties report the *real* edited size rather than the canvas', which
// is capped: that is what the caption under the preview shows.
function editedImage(node, edit) {
    const source = node.imgs?.[0];
    if (!source?.complete || !source.naturalWidth) return null;

    const key = `${source.src}|${JSON.stringify(edit)}`;
    if (node.__ntxEditedPreview?.key === key) return node.__ntxEditedPreview.canvas;

    let canvas = null;
    try {
        canvas = paintEdited(source, edit, PREVIEW_MAX_SIDE);
        const [width, height] = outputSize(source.naturalWidth, source.naturalHeight, edit);
        Object.defineProperty(canvas, "naturalWidth", { value: width });
        Object.defineProperty(canvas, "naturalHeight", { value: height });
    } catch (error) {
        console.error(`[${ADDON_PREFIX}] Load Image & Edit: the edited preview could not be drawn`, error);
        canvas = null;
    }
    node.__ntxEditedPreview = { key, canvas };
    return canvas;
}

// what the preview widget is showing : the edited picture, or the original
function shownImage(node, edit) {
    return (isEdited(edit) ? editedImage(node, edit) : null) ?? node.imgs?.[0] ?? null;
}

// -- The pencil icon ------------------------------------------------------------

// the rectangle the preview widget draws `image` in, in node coordinates
function previewGeometry(node, widget, image) {
    if (!widget || node?.flags?.collapsed) return null;
    if (!image?.naturalWidth || !image?.naturalHeight) return null;
    if (!widget.computedHeight) return null;

    const sizeTextHeight = settingValue("Comfy.Node.AllowImageSizeDraw", true) ? 15 : 0;
    const boxWidth = widget.width || node.size[0];
    const boxHeight = widget.computedHeight - sizeTextHeight;
    if (boxWidth <= 0 || boxHeight <= 0) return null;

    const scale = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight, 1);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;

    return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2 + widget.y, width, height };
}

// the icon sits in the top right corner of the picture, and is dropped altogether
// on a preview too small to hold it without covering what it is drawn on
function iconRect(geometry) {
    if (!geometry || geometry.width < ICON_SIZE * 3 || geometry.height < ICON_SIZE * 3) return null;
    return {
        x: geometry.x + geometry.width - ICON_SIZE - ICON_MARGIN,
        y: geometry.y + ICON_MARGIN,
        width: ICON_SIZE,
        height: ICON_SIZE,
    };
}

const isOverIcon = (rect, x, y) =>
    !!rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

function drawIcon(ctx, rect, edited) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 4);
    else ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = edited ? "rgba(58, 122, 194, 0.90)" : "rgba(0, 0, 0, 0.55)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.60)";
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(ICON_SIZE * 0.62)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✎", rect.x + rect.width / 2, rect.y + rect.height / 2 + 1);
}

// the cursor tells the icon is clickable, and is given back as soon as it is left
function updateCursor(widget, rect) {
    const canvas = app.canvas;
    const element = canvas?.canvas;
    const node = widget.node;
    if (!element || !node) return;

    const x = canvas.graph_mouse[0] - node.pos[0];
    const y = canvas.graph_mouse[1] - node.pos[1];
    if (rect && !canvas.pointer_is_down && isOverIcon(rect, x, y)) {
        element.style.cursor = "pointer";
        widget.__ntxEditCursor = true;
    } else if (widget.__ntxEditCursor) {
        element.style.cursor = "";
        widget.__ntxEditCursor = false;
    }
}

// -- The editor -----------------------------------------------------------------

// the editor is the one of the Media Loader's picture slots, opened on the
// *original* picture : node.imgs is never swapped, so its src is the original
function openPictureEditor(node) {
    const source = node.imgs?.[0];
    if (!source?.src) return;

    const item = { name: baseName(getWidget(node, IMAGE_WIDGET)?.value) || "picture", edit: readEdit(node) };
    openEditor(item, source.src, (edit) => {
        writeEdit(node, edit);
        node.graph?.afterChange?.();            // one step of the undo history
        node.setDirtyCanvas(true, true);
    });
}

// -- Wiring ---------------------------------------------------------------------

function patchPreviewWidget(widget) {
    if (!widget || widget.__ntxEditPatched) return;
    widget.__ntxEditPatched = true;

    const drawWidget = widget.drawWidget;
    widget.drawWidget = function (ctx, options) {
        const node = this.node;
        const edit = readEdit(node);
        const shown = shownImage(node, edit);
        const edited = shown && shown !== node.imgs?.[0];

        // previewImages is what the widget draws when it is given: the edits show
        // while node.imgs keeps the original, which is what the mask editor reads
        drawWidget.call(this, ctx, edited ? { ...options, previewImages: [shown] } : options);

        const rect = iconRect(previewGeometry(node, this, shown));
        try {
            updateCursor(this, rect);
        } catch (error) {
            console.error(`[${ADDON_PREFIX}] Load Image & Edit: cursor update failed`, error);
        }
        if (!rect) return;

        // The picture itself is drawn from a microtask the call above just queued
        // (a Chrome GPU workaround), so anything drawn synchronously on top of it
        // ends up underneath. The icon waits for a microtask of its own.
        const transform = ctx.getTransform();
        queueMicrotask(() => {
            ctx.save();
            try {
                ctx.setTransform(transform);
                drawIcon(ctx, rect, isEdited(edit));
            } catch (error) {
                console.error(`[${ADDON_PREFIX}] Load Image & Edit: the edit icon could not be drawn`, error);
            } finally {
                ctx.restore();
            }
        });
    };

    const onPointerDown = widget.onPointerDown;
    widget.onPointerDown = function (pointer, node, canvas) {
        const down = pointer?.eDown;
        if (down) {
            const rect = iconRect(previewGeometry(node, this, shownImage(node, readEdit(node))));
            if (isOverIcon(rect, down.canvasX - node.pos[0], down.canvasY - node.pos[1])) {
                // a click on the icon is still a click on the node
                const select = () => canvas?.processSelect?.(node, down);
                pointer.onDragStart = select;
                pointer.onClick = () => { select(); openPictureEditor(node); };
                return true;
            }
        }
        return onPointerDown ? onPointerDown.call(this, pointer, node, canvas) : false;
    };
}

// The preview widget is created by the core frontend on the node's first
// background draw, once an image has loaded, and dropped again when it has none.
function installPreviewHook(node) {
    const original = node.onDrawBackground;
    node.onDrawBackground = function () {
        const result = original?.apply(this, arguments);
        syncEditToImage(this);
        patchPreviewWidget(getWidget(this, PREVIEW_WIDGET));
        return result;
    };
}

// -- Paste -----------------------------------------------------------------------

// write an uploaded path into the image combo, the way the core upload does when
// it completes: the value has to be a known option, and setting it is not enough
// on its own - the combo's callback is what the core widget installed to refresh
// the node's preview, and it reads the widget rather than its argument, so the
// value goes in first.
function applyUploadedPath(node, widget, path) {
    if (!widget) return;

    const values = widget.options?.values;
    if (Array.isArray(values) && !values.includes(path)) values.push(path);

    const previous = widget.value;
    widget.value = path;
    widget.callback?.(path);
    node.onWidgetChanged?.(widget.name, path, previous, widget);
    node.graph?.afterChange?.();        // so the paste is one step of the undo history
}

async function uploadPastedImage(node, widget, file, coreHandler) {
    if (node.isUploading) return;
    node.isUploading = true;
    node.imgs = undefined;              // drop the previous preview while the new one uploads
    node.graph?.setDirtyCanvas(true);

    try {
        const body = new FormData();
        body.append("image", file, file.name || "image.png");
        const response = await api.fetchApi(UPLOAD_ROUTE, { method: "POST", body });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `upload failed (${response.status})`);

        applyUploadedPath(node, widget, data.subfolder ? `${data.subfolder}/${data.name}` : data.name);
    } catch (error) {
        // never lose a pasted image: hand it back to the core handler, which does
        // the same thing the slow way
        console.warn(`[${ADDON_PREFIX}] Load Image & Edit: falling back to the core paste upload -`, error);
        coreHandler?.call(node, [file]);
    } finally {
        node.isUploading = false;
        node.graph?.setDirtyCanvas(true);
    }
}

app.registerExtension({
    name: API_PREFIX + ".load_image.edit",

    nodeCreated(node) {
        if (node.comfyClass !== NODE_ID) return;

        const widget = getWidget(node, IMAGE_WIDGET);
        if (!widget) return;

        // the editor : the icon rides on the preview widget, which the core only
        // creates once an image has loaded, so the hook re-applies on every draw
        installPreviewHook(node);

        // the paste : the core handler is kept as the fallback of the fast one
        const coreHandler = node.pasteFiles;
        if (typeof coreHandler !== "function") return;      // nothing to take over, keep core

        node.pasteFiles = function (files) {
            // the core widget is not a batch one: a paste carrying several images
            // loads the first, like the stock Load Image node does
            const images = Array.from(files || []).filter((f) => f?.type?.startsWith("image/"));
            if (!images.length) return false;

            void uploadPastedImage(this, widget, images[0], coreHandler);
            return true;
        };
    },
});
