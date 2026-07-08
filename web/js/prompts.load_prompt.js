// CREATED WITH CLAUDE

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerNodeMenu, registerCanvasMenu } from "./menu.js";

const NODE_ID = ADDON_PREFIX + "LoadPrompt";
const ADV_NODE_ID = ADDON_PREFIX + "LoadPromptAdvanced";
const CHAR_NODE_ID = ADDON_PREFIX + "LoadPromptChar";
const ID_WIDGET = "id";
const PROMPT_WIDGET = "prompt";

// All LoadPrompt* share the exact same id/prompt behaviour
// (tree picker + textbox sync); the advanced nodes just add plain string widgets.
const PROMPT_NODE_IDS = new Set([NODE_ID, ADV_NODE_ID, CHAR_NODE_ID]);

const SAVE_NODE_ID = ADDON_PREFIX + "SavePrompt";
const CATEGORY_WIDGET = "category";

// {id: prompt} map mirrored from the backend (py/prompts.py). Fetched once and
// reused; used to fill the prompt textbox when the id combobox changes and to
// build the hierarchical tree picker.
let promptsMap = null;
let promptsMapPromise = null;

// {id: {paramN: value}} map mirrored from the backend; only ids that define at
// least one param appear. Used by LoadPromptAdvanced to fill its param widgets.
let promptsParams = null;
let promptsParamsPromise = null;

async function getPromptsMap() {
    if (promptsMap) return promptsMap;
    if (!promptsMapPromise) {
        promptsMapPromise = api.fetchApi(`/${API_PREFIX}/load_prompts`)
            .then((resp) => resp.json())
            .then((data) => (promptsMap = data || {}))
            .catch((err) => {
                console.error("LoadPrompt : failed to load prompts map", err);
                return (promptsMap = {});
            });
    }
    return promptsMapPromise;
}

async function getPromptsParams() {
    if (promptsParams) return promptsParams;
    if (!promptsParamsPromise) {
        promptsParamsPromise = api.fetchApi(`/${API_PREFIX}/load_prompt_params`)
            .then((resp) => resp.json())
            .then((data) => (promptsParams = data || {}))
            .catch((err) => {
                console.error("LoadPrompt : failed to load prompt params map", err);
                return (promptsParams = {});
            });
    }
    return promptsParamsPromise;
}

// ask the backend to re-read the prompt files from disk and refresh the cached maps
async function reloadPromptsMap() {
    try {
        const resp = await api.fetchApi(`/${API_PREFIX}/reload_prompts`, { method: "POST" });
        promptsMap = (await resp.json()) || {};
        // the reload rebuilt the params too; pull the fresh copy
        const presp = await api.fetchApi(`/${API_PREFIX}/load_prompt_params`);
        promptsParams = (await presp.json()) || {};
        updateIdComboOptions();
    } catch (err) {
        console.error("LoadPrompt : failed to reload prompts map", err);
    }
    return promptsMap;
}

// the id combo is a standard combo whose options are baked into the node
// definition, so after a reload the fresh id list is pushed into every
// LoadPrompt* node here — otherwise the native dropdown would stay stale until
// the node definitions are refreshed (page load / "Refresh Node Definitions").
function updateIdComboOptions() {
    const ids = Object.keys(promptsMap || {}).sort();
    if (!ids.length) return;
    for (const node of app.graph?._nodes ?? []) {
        if (!PROMPT_NODE_IDS.has(node.comfyClass)) continue;
        const idWidget = node.widgets?.find((w) => w.name === ID_WIDGET);
        if (idWidget?.options) idWidget.options.values = ids;
    }
}

// the id combo options rebuild from disk on every node-definitions fetch — see
// id_input() in py/prompts.py. The maps cached here can therefore lag behind the
// combo; this refetches them when the combo hands us an id they do not know yet.
async function ensureIdKnown(id) {
    if (!promptsMap || id in promptsMap) return;
    promptsMap = null;
    promptsMapPromise = null;
    promptsParams = null;
    promptsParamsPromise = null;
    await getPromptsMap();
    await getPromptsParams();
}

// toast shown after the prompt cache has been re-read from disk
function notifyPromptsReloaded() {
    try {
        app.extensionManager?.toast?.add({
            severity: "success",
            summary: "Prompt cache reloaded",
            detail: "Prompt files re-read from disk",
            life: 4000,
        });
    } catch (err) {
        console.log("Prompt files re-read from disk");
    }
}

// copy text to the clipboard, falling back to a hidden textarea when the async
// Clipboard API is unavailable (e.g. non-secure context). Returns true on success.
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        } catch (e) {
            console.error("LoadPrompt : clipboard copy failed", e);
            return false;
        }
    }
}

// fill the prompt textbox with the library text for the selected id
function applyPrompt(node, id) {
    const promptWidget = node.widgets?.find((w) => w.name === PROMPT_WIDGET);
    if (!promptWidget || promptsMap == null) return;
    if (!(id in promptsMap)) return;
    promptWidget.value = promptsMap[id];
    node.setDirtyCanvas(true, true);
}

// fill the param widgets from the selected id, clearing any the id does not
// define. Each param widget is matched by its *current* (user-facing) name, so
// renaming e.g. "param3" to "save_name" makes it pick up the id's "save_name"
// value instead. The param widgets are every widget other than id and prompt, so
// this is a no-op on the basic LoadPrompt node, which has none.
function applyParams(node, id) {
    if (promptsParams == null) return;
    const entry = promptsParams[id] || {};
    let changed = false;
    for (const widget of node.widgets ?? []) {
        if (widget.name === ID_WIDGET || widget.name === PROMPT_WIDGET) continue;
        widget.value = entry[widget.label] ?? "";
        changed = true;
    }
    if (changed) node.setDirtyCanvas(true, true);
}

// set the id combobox to a new value, going through its callback so the prompt
// textbox is refreshed exactly as a manual selection would
function selectId(node, id) {
    const idWidget = node.widgets?.find((w) => w.name === ID_WIDGET);
    if (!idWidget) return;
    idWidget.value = id;
    idWidget.callback?.(id);
    node.setDirtyCanvas(true, true);
}

// ── Tree picker ────────────────────────────────────────────────────────────────

const CSS = `
.lpt-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
}
.lpt-panel {
    width: 420px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    background: var(--comfy-menu-bg, #202020);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
}
.lpt-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.lpt-filter {
    width: 100%;
    box-sizing: border-box;
    height: 28px;
    margin-bottom: 8px;
    padding: 2px 8px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 13px;
}
.lpt-tree {
    flex: 1 1 auto;
    overflow: auto;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px;
    background: var(--comfy-input-bg, #1a1a1a);
    min-height: 120px;
}
.lpt-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
}
.lpt-row:hover { background: rgba(255, 255, 255, 0.07); }
.lpt-cat { font-weight: 600; }
.lpt-toggle {
    width: 14px;
    display: inline-block;
    text-align: center;
    opacity: 0.8;
    user-select: none;
}
.lpt-leaf.lpt-selected { background: #2d5a8a; color: #fff; }
.lpt-empty { padding: 12px; opacity: 0.6; font-size: 13px; }
.lpt-preview {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    padding: 6px;
    border: 1px solid #444;
    border-radius: 4px;
    background: var(--comfy-input-bg, #1a1a1a);
    min-height: 48px;
    max-height: 130px;
    flex: 0 0 auto;
    box-sizing: border-box;
}
.lpt-preview-img {
    flex: 0 0 auto;
    max-width: 110px;
    max-height: 110px;
    object-fit: contain;
    border-radius: 3px;
    align-self: center;
}
.lpt-preview-text {
    flex: 1 1 auto;
    overflow: auto;
    font-size: 11px;
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-word;
}
.lpt-preview-text.lpt-placeholder { opacity: 0.5; }
.lpt-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
}
.lpt-btn {
    height: 28px;
    padding: 0 14px;
    border: 1px solid #444;
    border-radius: 4px;
    background: var(--comfy-input-bg, #1a1a1a);
    color: var(--input-text, #ccc);
    font-size: 13px;
    cursor: pointer;
}
.lpt-btn:hover:not(:disabled) { border-color: #4a90d9; color: #fff; }
.lpt-btn-ok { background: #2d5a8a; color: #fff; border-color: #2d5a8a; }
.lpt-btn:disabled { opacity: 0.4; cursor: default; }
`;

function ensureStyles() {
    if (document.getElementById("lpt-styles")) return;
    const el = document.createElement("style");
    el.id = "lpt-styles";
    el.textContent = CSS;
    document.head.appendChild(el);
}

// Build a nested tree from the flat ids. Each node: { children: Map, leaf: <id|null> }.
// A node with children is a category; a node carrying `leaf` is a selectable entry.
function buildTree(ids) {
    const root = { children: new Map(), leaf: null };
    for (const id of ids) {
        const parts = id.split("/");
        let cur = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!cur.children.has(part)) {
                cur.children.set(part, { children: new Map(), leaf: null });
            }
            cur = cur.children.get(part);
            if (i === parts.length - 1) cur.leaf = id;
        }
    }
    return root;
}

// does this subtree contain a leaf matching the (lower-cased) query?
function subtreeMatches(node, q) {
    if (node.leaf && (q === "" || node.leaf.toLowerCase().includes(q))) return true;
    for (const child of node.children.values()) {
        if (subtreeMatches(child, q)) return true;
    }
    return false;
}

// node may be null when the picker is opened from a generic node / the empty
// canvas (there is no id widget to preselect or write back to).
// opts.title     — panel heading (defaults to "Select a prompt")
// opts.currentId — id to preselect/expand when there is no id widget
// opts.onConfirm — called with the chosen id instead of the default behaviour of
//                  writing it into the node's id widget (used by the RMB
//                  "Pick prompt" entry to copy the prompt text to the clipboard)
function openTreePicker(node, opts = {}) {
    const idWidget = node?.widgets?.find((w) => w.name === ID_WIDGET);
    // the default confirm writes into the id widget, so that path needs one;
    // callers that pass onConfirm (clipboard picker) do not.
    if (!idWidget && !opts.onConfirm) return;

    ensureStyles();

    let ids = Object.keys(promptsMap || {});
    let tree = buildTree(ids);
    // the node's id widget wins; otherwise fall back to opts.currentId (used by
    // the clipboard picker to reopen on the last selection)
    const currentId = idWidget?.value ?? opts.currentId;

    // categories expanded by default: the ancestors of the current selection
    const expanded = new Set();
    if (typeof currentId === "string") {
        const parts = currentId.split("/");
        let path = "";
        for (let i = 0; i < parts.length - 1; i++) {
            path = path ? `${path}/${parts[i]}` : parts[i];
            expanded.add(path);
        }
    }

    let selectedId = ids.includes(currentId) ? currentId : null;
    let query = "";

    // overlay + panel
    const overlay = document.createElement("div");
    overlay.className = "lpt-overlay";

    const panel = document.createElement("div");
    panel.className = "lpt-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "lpt-title";
    title.textContent = opts.title || "Select a prompt";
    panel.appendChild(title);

    const filter = document.createElement("input");
    filter.className = "lpt-filter";
    filter.type = "text";
    filter.placeholder = "Filter…";
    panel.appendChild(filter);

    const treeEl = document.createElement("div");
    treeEl.className = "lpt-tree";
    panel.appendChild(treeEl);

    // preview of the highlighted prompt: library text + thumbnail (if any)
    const preview = document.createElement("div");
    preview.className = "lpt-preview";
    const previewImg = document.createElement("img");
    previewImg.className = "lpt-preview-img";
    previewImg.style.display = "none";
    const previewText = document.createElement("div");
    previewText.className = "lpt-preview-text";
    preview.appendChild(previewImg);
    preview.appendChild(previewText);
    panel.appendChild(preview);

    function updatePreview() {
        previewImg.style.display = "none";
        previewImg.removeAttribute("src");
        if (!selectedId) {
            previewText.classList.add("lpt-placeholder");
            previewText.textContent = "Select a prompt to preview it.";
            return;
        }
        previewText.classList.remove("lpt-placeholder");
        previewText.textContent = promptsMap?.[selectedId] ?? "";
        previewImg.onload = () => { previewImg.style.display = ""; };
        previewImg.onerror = () => { previewImg.style.display = "none"; };
        previewImg.src = `/${API_PREFIX}/view_prompt_image?id=${encodeURIComponent(selectedId)}`;
    }

    const buttons = document.createElement("div");
    buttons.className = "lpt-buttons";
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "lpt-btn";
    refreshBtn.textContent = "Refresh";
    refreshBtn.title = "Re-read the prompt files from disk";
    const spacer = document.createElement("span");
    spacer.style.flex = "1 1 auto";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "lpt-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "lpt-btn lpt-btn-ok";
    okBtn.textContent = "OK";
    buttons.appendChild(refreshBtn);
    buttons.appendChild(spacer);
    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);
    panel.appendChild(buttons);

    function close() {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
    }
    function confirm() {
        if (!selectedId) return;
        if (opts.onConfirm) opts.onConfirm(selectedId);
        else selectId(node, selectedId);
        close();
    }
    async function refresh() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "Refreshing…";
        await reloadPromptsMap();
        ids = Object.keys(promptsMap || {});
        tree = buildTree(ids);
        if (!ids.includes(selectedId)) selectedId = null;  // dropped from the library
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh";
        renderTree();
        notifyPromptsReloaded();
    }

    let selectedRowEl = null;

    function renderTree() {
        treeEl.innerHTML = "";
        selectedRowEl = null;
        okBtn.disabled = !selectedId;

        const render = (parentEl, treeNode, pathPrefix, depth) => {
            const names = [...treeNode.children.keys()].sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: "base" }),
            );
            for (const name of names) {
                const child = treeNode.children.get(name);
                if (!subtreeMatches(child, query)) continue;
                const childPath = pathPrefix ? `${pathPrefix}/${name}` : name;
                const isCategory = child.children.size > 0;

                const row = document.createElement("div");
                row.className = "lpt-row " + (isCategory ? "lpt-cat" : "lpt-leaf");
                row.style.paddingLeft = `${4 + depth * 14}px`;

                if (isCategory) {
                    const isOpen = query !== "" || expanded.has(childPath);
                    const toggle = document.createElement("span");
                    toggle.className = "lpt-toggle";
                    toggle.textContent = isOpen ? "▾" : "▸";
                    row.appendChild(toggle);
                    const label = document.createElement("span");
                    label.textContent = name;
                    row.appendChild(label);
                    row.addEventListener("click", () => {
                        if (expanded.has(childPath)) expanded.delete(childPath);
                        else expanded.add(childPath);
                        renderTree();
                    });
                    parentEl.appendChild(row);
                    if (isOpen) render(parentEl, child, childPath, depth + 1);
                } else {
                    const spacer = document.createElement("span");
                    spacer.className = "lpt-toggle";
                    row.appendChild(spacer);
                    const label = document.createElement("span");
                    label.textContent = name;
                    row.appendChild(label);
                    if (child.leaf === selectedId) {
                        row.classList.add("lpt-selected");
                        selectedRowEl = row;
                    }
                    row.addEventListener("click", () => {
                        selectedId = child.leaf;
                        renderTree();
                    });
                    row.addEventListener("dblclick", () => {
                        selectedId = child.leaf;
                        confirm();
                    });
                    parentEl.appendChild(row);
                }
            }
        };

        render(treeEl, tree, "", 0);

        if (!treeEl.childElementCount) {
            const empty = document.createElement("div");
            empty.className = "lpt-empty";
            empty.textContent = ids.length ? "No matches." : "No prompts found.";
            treeEl.appendChild(empty);
        }
        if (selectedRowEl) selectedRowEl.scrollIntoView({ block: "nearest" });
        updatePreview();
    }

    function onKey(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            confirm();
        }
    }

    filter.addEventListener("input", () => {
        query = filter.value.trim().toLowerCase();
        renderTree();
    });
    refreshBtn.addEventListener("click", refresh);
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", confirm);
    overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(overlay);
    renderTree();
    filter.focus();
}

// ── Category picker (for SavePrompt) ────────────────────────────────────────────

// every category path that exists in the library, e.g. "scenes" and "scenes/fantasy"
// from the leaf id "scenes/fantasy/castle" — i.e. all the parent prefixes.
function computeCategories(map) {
    const cats = new Set();
    for (const id of Object.keys(map || {})) {
        const parts = id.split("/");
        let path = "";
        for (let i = 0; i < parts.length - 1; i++) {
            path = path ? `${path}/${parts[i]}` : parts[i];
            cats.add(path);
        }
    }
    return [...cats];
}

// nested tree of categories; every node is selectable and carries its full path
function buildCategoryTree(cats) {
    const root = { children: new Map(), path: null };
    for (const cat of cats) {
        const parts = cat.split("/");
        let cur = root;
        let path = "";
        for (const part of parts) {
            path = path ? `${path}/${part}` : part;
            if (!cur.children.has(part)) {
                cur.children.set(part, { children: new Map(), path });
            }
            cur = cur.children.get(part);
        }
    }
    return root;
}

// does this subtree contain a category matching the (lower-cased) query?
function categoryMatches(node, q) {
    if (node.path && (q === "" || node.path.toLowerCase().includes(q))) return true;
    for (const child of node.children.values()) {
        if (categoryMatches(child, q)) return true;
    }
    return false;
}

function openCategoryPicker(node) {
    const catWidget = node.widgets?.find((w) => w.name === CATEGORY_WIDGET);
    if (!catWidget) return;

    ensureStyles();

    const cats = computeCategories(promptsMap);
    const tree = buildCategoryTree(cats);
    const currentCat = String(catWidget.value ?? "");

    // expand the ancestors of the current category by default
    const expanded = new Set();
    if (currentCat) {
        const parts = currentCat.split("/");
        let path = "";
        for (let i = 0; i < parts.length - 1; i++) {
            path = path ? `${path}/${parts[i]}` : parts[i];
            expanded.add(path);
        }
    }

    let selectedPath = cats.includes(currentCat) ? currentCat : null;
    let query = "";

    const overlay = document.createElement("div");
    overlay.className = "lpt-overlay";
    const panel = document.createElement("div");
    panel.className = "lpt-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "lpt-title";
    title.textContent = "Select a category";
    panel.appendChild(title);

    const filter = document.createElement("input");
    filter.className = "lpt-filter";
    filter.type = "text";
    filter.placeholder = "Filter…";
    panel.appendChild(filter);

    const treeEl = document.createElement("div");
    treeEl.className = "lpt-tree";
    panel.appendChild(treeEl);

    const buttons = document.createElement("div");
    buttons.className = "lpt-buttons";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "lpt-btn";
    cancelBtn.textContent = "Cancel";
    const okBtn = document.createElement("button");
    okBtn.className = "lpt-btn lpt-btn-ok";
    okBtn.textContent = "OK";
    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);
    panel.appendChild(buttons);

    function close() {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
    }
    function confirm() {
        if (!selectedPath) return;
        catWidget.value = selectedPath;
        catWidget.callback?.(selectedPath);
        node.setDirtyCanvas(true, true);
        close();
    }

    let selectedRowEl = null;

    function renderTree() {
        treeEl.innerHTML = "";
        selectedRowEl = null;
        okBtn.disabled = !selectedPath;

        const render = (parentEl, treeNode, depth) => {
            const names = [...treeNode.children.keys()].sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: "base" }),
            );
            for (const name of names) {
                const child = treeNode.children.get(name);
                if (!categoryMatches(child, query)) continue;
                const hasChildren = child.children.size > 0;
                const isOpen = query !== "" || expanded.has(child.path);

                // every category is selectable; if it has children it is also expandable
                const row = document.createElement("div");
                row.className = "lpt-row lpt-cat lpt-leaf";
                row.style.paddingLeft = `${4 + depth * 14}px`;

                const toggle = document.createElement("span");
                toggle.className = "lpt-toggle";
                toggle.textContent = hasChildren ? (isOpen ? "▾" : "▸") : "";
                if (hasChildren) {
                    toggle.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        if (expanded.has(child.path)) expanded.delete(child.path);
                        else expanded.add(child.path);
                        renderTree();
                    });
                }
                row.appendChild(toggle);

                const label = document.createElement("span");
                label.textContent = name;
                row.appendChild(label);

                if (child.path === selectedPath) {
                    row.classList.add("lpt-selected");
                    selectedRowEl = row;
                }
                row.addEventListener("click", () => {
                    selectedPath = child.path;
                    renderTree();
                });
                row.addEventListener("dblclick", () => {
                    selectedPath = child.path;
                    confirm();
                });

                parentEl.appendChild(row);
                if (hasChildren && isOpen) render(parentEl, child, depth + 1);
            }
        };

        render(treeEl, tree, 0);

        if (!treeEl.childElementCount) {
            const empty = document.createElement("div");
            empty.className = "lpt-empty";
            empty.textContent = cats.length ? "No matches." : "No categories found.";
            treeEl.appendChild(empty);
        }
        if (selectedRowEl) selectedRowEl.scrollIntoView({ block: "nearest" });
    }

    function onKey(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            confirm();
        }
    }

    filter.addEventListener("input", () => {
        query = filter.value.trim().toLowerCase();
        renderTree();
    });
    cancelBtn.addEventListener("click", close);
    okBtn.addEventListener("click", confirm);
    overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(overlay);
    renderTree();
    filter.focus();
}

// ── Shift+click interception on the id combobox ─────────────────────────────────

// A single document-level capture listener: when the user shift+clicks the `id`
// widget of a LoadPrompt node (or the `category` box of a SavePrompt node), swallow
// the event (so the native widget does not react) and show the tree picker instead.
function onCapturePointerDown(e) {
    if (!e.shiftKey || e.button !== 0) return;
    const canvas = app.canvas;
    const graph = canvas?.graph || app.graph;
    if (!canvas || !graph || typeof canvas.adjustMouseEvent !== "function") return;

    canvas.adjustMouseEvent(e);
    const node = graph.getNodeOnPos?.(e.canvasX, e.canvasY);
    if (!node) return;
    const widget = node.getWidgetOnPos?.(e.canvasX, e.canvasY, false);
    if (!widget) return;

    let picker = null;
    if (PROMPT_NODE_IDS.has(node.comfyClass) && widget.name === ID_WIDGET) {
        picker = openTreePicker;
    } else if (node.comfyClass === SAVE_NODE_ID && widget.name === CATEGORY_WIDGET) {
        picker = openCategoryPicker;
    }
    if (!picker) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    getPromptsMap().then(() => picker(node));
}

// ── RMB "Pick prompt" (copy to clipboard) ───────────────────────────────────────

// Last id confirmed through the clipboard picker. Used to reopen the picker on
// the previous selection when it is not bound to a node's id widget.
let lastClipboardPickId = null;

// Open the tree picker purely to copy a prompt to the clipboard. `node` is
// optional — when opened on a LoadPrompt node it preselects that node's current
// id; otherwise it reopens on the last selection made here.
function openClipboardPromptPicker(node) {
    getPromptsMap().then(() => openTreePicker(node, {
        title: "Pick a prompt to copy",
        currentId: lastClipboardPickId,
        onConfirm: (id) => {
            lastClipboardPickId = id;
            const text = promptsMap?.[id] ?? "";
            copyToClipboard(text).then((ok) => {
                try {
                    app.extensionManager?.toast?.add({
                        severity: ok ? "success" : "error",
                        summary: ok ? "Prompt copied" : "Copy failed",
                        detail: ok
                            ? `"${id}" copied to the clipboard`
                            : "Could not access the clipboard",
                        life: 4000,
                    });
                } catch (err) {
                    console.log(ok ? `"${id}" copied to the clipboard` : "clipboard copy failed");
                }
            });
        },
    }));
}

// ── RMB menus (grouped into the addon submenu) ───────────────────────────────────

// "Pick prompt" on every node's RMB menu and on the empty-canvas RMB menu.
const pickEntry = (node) => ({
    content: "📝 Pick prompt",
    callback: () => openClipboardPromptPicker(node),
});
registerNodeMenu((node) => pickEntry(node));
registerCanvasMenu(() => pickEntry(null));

// On the prompt nodes, an entry to re-read the prompt files from disk — same
// effect as the tree picker's Refresh button.
registerNodeMenu((node) => {
    if (!node || !PROMPT_NODE_IDS.has(node.comfyClass)) return [];
    return [{
        content: "🔃 Rebuild Prompts List from disk",
        callback: () => {
            reloadPromptsMap().then(() => notifyPromptsReloaded());
        },
    }];
});

app.registerExtension({
    name: API_PREFIX + ".prompts.load_prompt",

    setup() {
        document.addEventListener("pointerdown", onCapturePointerDown, true);

        // show backend-sent toasts (e.g. SavePrompt overwrite warnings) to the user
        api.addEventListener(`${API_PREFIX}.toast`, (e) => {
            const d = e.detail || {};
            try {
                app.extensionManager?.toast?.add({
                    severity: d.severity || "info",
                    summary: d.summary || "",
                    detail: d.detail || "",
                    life: 5000,
                });
            } catch (err) {
                console.log(`${d.summary}: ${d.detail}`);
            }
        });
    },

    async nodeCreated(node) {
        if (!PROMPT_NODE_IDS.has(node.comfyClass)) return;

        const idWidget = node.widgets?.find((w) => w.name === ID_WIDGET);
        if (!idWidget) return;

        await getPromptsMap();
        await getPromptsParams();

        // sync the textbox (and the advanced node's param widgets) whenever the
        // id selection changes. The id whose library text was last applied is
        // tracked so a manually edited prompt is not overwritten silently.
        let lastAppliedId = idWidget.value;

        const originalCallback = idWidget.callback;
        idWidget.callback = function (value, ...args) {
            const ret = originalCallback?.apply(this, [value, ...args]);

            const promptWidget = node.widgets?.find((w) => w.name === PROMPT_WIDGET);
            const current = String(promptWidget?.value ?? "").trim();
            const lastLib = String(promptsMap?.[lastAppliedId] ?? "").trim();
            const edited = current !== "" && current !== lastLib;

            (async () => {
                // the combo options can be newer than the cached maps
                await ensureIdKnown(value);
                if (!edited || window.confirm(
                    `The prompt text was edited manually.\nReplace it with the library text of "${value}"?`)) {
                    applyPrompt(node, value);
                    applyParams(node, value);
                }
                lastAppliedId = value;
            })();

            return ret;
        };
    },
});
