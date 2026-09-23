// CREATED WITH CLAUDE
//
// Fast paste for the Load Image & Edit node (py/load_image.py, class LoadImageAndEdit).
//
// The node is a plain Load Image: the combo, the upload button, the preview and
// the mask editor all come from the core frontend, untouched. This module only
// replaces what happens when an image is *pasted* on it.
//
// The core paste handler (useNodePaste, installed by the IMAGEUPLOAD widget)
// posts the image to /upload/image with subfolder=pasted, and the server picks a
// free "image (N).png" there by re-reading and re-hashing every file of that
// series, on every single paste. Once input/pasted holds a few hundred images
// that is seconds of disk churn, on the server's event loop, before the pasted
// image appears. The addon's own route does the same job against a hash register
// kept next to the images, so it only ever hashes the incoming one.
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

const NODE_ID = ADDON_PREFIX + "LoadImageAndEdit";

// the combo holding the file name, and the route that fills it
const IMAGE_WIDGET = "image";
const UPLOAD_ROUTE = `/${API_PREFIX}/load_image/upload_pasted`;

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

        const coreHandler = node.pasteFiles;
        if (typeof coreHandler !== "function") return;      // nothing to take over, keep core

        const widget = node.widgets?.find((w) => w.name === IMAGE_WIDGET);
        if (!widget) return;

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
