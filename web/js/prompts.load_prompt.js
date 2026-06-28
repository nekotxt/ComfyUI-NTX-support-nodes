// CREATED WITH CLAUDE

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_ID = ADDON_PREFIX + "LoadPrompt";
const ADV_NODE_ID = ADDON_PREFIX + "LoadPromptAdvanced";
const ID_WIDGET = "id";
const PROMPT_WIDGET = "prompt";

// LoadPrompt and LoadPromptAdvanced share the exact same id/prompt behaviour
// (tree picker + textbox sync); the advanced node just adds plain string widgets.
const PROMPT_NODE_IDS = new Set([NODE_ID, ADV_NODE_ID]);

const SAVE_NODE_ID = ADDON_PREFIX + "SavePrompt";
const CATEGORY_WIDGET = "category";

// {id: prompt} map mirrored from the backend (py/prompts.py). Fetched once and
// reused; used to fill the prompt textbox when the id combobox changes and to
// build the hierarchical tree picker.
let promptsMap = null;
let promptsMapPromise = null;

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

// ask the backend to re-read the prompt files from disk and refresh the cached map
async function reloadPromptsMap() {
    try {
        const resp = await api.fetchApi(`/${API_PREFIX}/reload_prompts`, { method: "POST" });
        promptsMap = (await resp.json()) || {};
    } catch (err) {
        console.error("LoadPrompt : failed to reload prompts map", err);
    }
    return promptsMap;
}

// fill the prompt textbox with the library text for the selected id
function applyPrompt(node, id) {
    const promptWidget = node.widgets?.find((w) => w.name === PROMPT_WIDGET);
    if (!promptWidget || promptsMap == null) return;
    if (!(id in promptsMap)) return;
    promptWidget.value = promptsMap[id];
    node.setDirtyCanvas(true, true);
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

function openTreePicker(node) {
    const idWidget = node.widgets?.find((w) => w.name === ID_WIDGET);
    if (!idWidget) return;

    ensureStyles();

    let ids = Object.keys(promptsMap || {});
    let tree = buildTree(ids);
    const currentId = idWidget.value;

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
    title.textContent = "Select a prompt";
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
        selectId(node, selectedId);
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
        try {
            app.extensionManager?.toast?.add({
                severity: "success",
                summary: "Prompt cache reloaded",
                detail: "Prompt cache reloaded: press R to refresh combo",
                life: 4000,
            });
        } catch (err) {
            console.log("Prompt cache reloaded: press R to refresh combo");
        }
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

        // sync the textbox whenever the id selection changes
        const originalCallback = idWidget.callback;
        idWidget.callback = function (value, ...args) {
            const ret = originalCallback?.apply(this, [value, ...args]);
            applyPrompt(node, value);
            return ret;
        };
    },
});
