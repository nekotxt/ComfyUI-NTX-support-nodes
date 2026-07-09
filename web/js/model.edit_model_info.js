// CREATED WITH CLAUDE FABLE 5
//
// Global RMB option "Edit model info".
//
// Shows a tree of every .safetensors model on disk (checkpoints,
// diffusion_models, loras, vae, text_encoders — organised by branch, then by
// subdir). Once a model is chosen, the server opens its side-car .txt file in
// the OS default editor; when no .txt exists yet, the user picks one of the
// templates in ntx_data/modeldata, which is copied next to the model and then
// opened. Backend routes live in py/model.py.
//
// The model list is fetched once and cached for the session; the Refresh
// button forces a rescan.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { API_PREFIX } from "./config.js";
import { registerNodeMenu, registerCanvasMenu } from "./menu.js";

// ── Styles ────────────────────────────────────────────────────────────────────
// Visually aligned with the load_template_workflow.js picker (lwt-*).

const CSS = `
.emi-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 99998;
    display: flex;
    align-items: center;
    justify-content: center;
}

.emi-panel {
    display: flex;
    flex-direction: column;
    width: 460px;
    max-width: 90vw;
    max-height: 75vh;
    background: #1e1e1e;
    border: 1px solid #555;
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.7);
    font-family: sans-serif;
    font-size: 12px;
    color: #ccc;
    overflow: hidden;
}

.emi-title {
    padding: 9px 12px;
    font-size: 13px;
    color: #eee;
    background: #252525;
    border-bottom: 1px solid #444;
    user-select: none;
}

.emi-title small {
    display: block;
    margin-top: 2px;
    font-size: 10px;
    color: #777;
}

.emi-filter {
    margin: 8px 10px 4px;
    padding: 5px 7px;
    background: #252525;
    border: 1px solid #444;
    border-radius: 3px;
    color: #ccc;
    font-size: 11px;
    outline: none;
}

.emi-filter:focus {
    border-color: #4a90d9;
}

.emi-tree {
    flex: 1 1 auto;
    overflow-y: auto;
    margin: 4px 4px 6px;
    padding: 0 6px;
    min-height: 120px;
}

.emi-empty {
    padding: 24px 10px;
    text-align: center;
    color: #777;
}

.emi-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
}

.emi-row:hover {
    background: rgba(255, 255, 255, 0.06);
}

.emi-row.selected {
    background: rgba(74, 144, 217, 0.25);
    color: #fff;
}

.emi-row .emi-ico {
    flex: 0 0 auto;
    font-size: 10px;
    color: #888;
}

.emi-row.folder .emi-ico {
    color: #c9a44a;
}

.emi-row.branch > span:last-child {
    color: #ddd;
    font-weight: bold;
}

.emi-children {
    margin-left: 14px;
    border-left: 1px solid #333;
    padding-left: 4px;
}

.emi-children.collapsed {
    display: none;
}

.emi-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 10px;
    background: #252525;
    border-top: 1px solid #444;
}

.emi-btn {
    padding: 5px 16px;
    background: #2a2a2a;
    color: #bbb;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
}

.emi-btn:hover {
    background: #3a3a3a;
    color: #eee;
}

.emi-btn.primary {
    background: #2c5687;
    border-color: #4a90d9;
    color: #fff;
}

.emi-btn.primary:hover {
    background: #3a6ca7;
}

.emi-btn:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
}

.emi-btn.refresh {
    margin-right: auto;   /* push the confirm/cancel buttons to the right */
}

.emi-btn.refresh.busy {
    opacity: 0.6;
    pointer-events: none;
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

// ── Model listing ─────────────────────────────────────────────────────────────

function toast(severity, summary, detail) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 4000 });
}

// Fetched once and reused for the whole session; Refresh forces a reload.
// Shape: { checkpoints: ["subdir/model.safetensors", ...], diffusion_models: [...], ... }
let _modelListCache = null;

async function fetchModelList(force = false) {
    if (_modelListCache && !force) return _modelListCache;
    const resp = await api.fetchApi(`/${API_PREFIX}/edit_model_info/models`);
    if (!resp.ok) throw new Error(`model listing HTTP ${resp.status}`);
    _modelListCache = await resp.json();
    return _modelListCache;
}

// ── Opening / creating the .txt file ──────────────────────────────────────────
// A key identifies a model as "<branch>/<relative/path.safetensors>".

function splitKey(key) {
    const idx = key.indexOf("/");
    return { model_type: key.slice(0, idx), model_name: key.slice(idx + 1) };
}

// Model key that was opened most recently; pre-selected when the picker is
// reopened, with its parent folders expanded and scrolled into view.
let _lastOpenedKey = null;

async function openModelInfo(key, template = null) {
    const { model_type, model_name } = splitKey(key);

    let data;
    try {
        const resp = await api.fetchApi(`/${API_PREFIX}/edit_model_info/open`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model_type, model_name, template }),
        });
        data = await resp.json();
    } catch (err) {
        console.error("[EditModelInfo] request failed:", err);
        toast("error", "Edit model info", `Failed to reach the server: ${err.message ?? err}`);
        return;
    }

    if (data?.status === "opened") {
        _lastOpenedKey = key;
        toast("success", "Edit model info", `Opened ${data.path}`);
    } else if (data?.status === "missing") {
        // No .txt next to the model yet: ask for a template, then call again.
        if (!data.templates?.length) {
            toast("error", "Edit model info",
                "No info file exists for this model, and no templates were found in ntx_data/modeldata.");
            return;
        }
        openTemplateChooser(key, data.templates);
    } else {
        toast("error", "Edit model info", data?.message ?? "Unknown error");
    }
}

// ── Tree model ────────────────────────────────────────────────────────────────
// The top level is the fixed model branches; below that, the subdir structure
// of each branch. Every node is { dirs: Map(name -> node), files: [{name, key}] }.

function buildTree(branches) {
    const root = { dirs: new Map(), files: [] };
    for (const [branch, paths] of Object.entries(branches)) {
        if (!paths?.length) continue;
        const branchNode = { dirs: new Map(), files: [] };
        root.dirs.set(branch, branchNode);
        for (const p of paths) {
            const parts = p.split("/");
            let node = branchNode;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!node.dirs.has(parts[i])) {
                    node.dirs.set(parts[i], { dirs: new Map(), files: [] });
                }
                node = node.dirs.get(parts[i]);
            }
            node.files.push({ name: parts[parts.length - 1], key: `${branch}/${p}` });
        }
    }
    return root;
}

// ── Model picker dialog ───────────────────────────────────────────────────────

function openModelDialog(branches, initialFilter = "") {
    injectStyles();
    document.querySelector(".emi-overlay")?.remove();

    const tree = buildTree(branches);
    const allKeys = new Set(
        Object.entries(branches).flatMap(([branch, paths]) => (paths ?? []).map(p => `${branch}/${p}`))
    );
    const expanded = new Set();        // folder paths currently expanded
    let selectedKey = allKeys.has(_lastOpenedKey) ? _lastOpenedKey : null;
    let lastClick = { key: null, time: 0 };    // manual double-click detection

    // Expand the folders on the way to the remembered selection.
    if (selectedKey) {
        const parts = selectedKey.split("/");
        let dirPath = "";
        for (let i = 0; i < parts.length - 1; i++) {
            dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i];
            expanded.add(dirPath);
        }
    }

    const overlay = document.createElement("div");
    overlay.className = "emi-overlay";

    const panel = document.createElement("div");
    panel.className = "emi-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "emi-title";
    title.innerHTML = `Edit model info<small>Select a model to open its .txt info file</small>`;
    panel.appendChild(title);

    const filterInput = document.createElement("input");
    filterInput.className = "emi-filter";
    filterInput.type = "text";
    filterInput.placeholder = "Filter…";
    filterInput.setAttribute("autocomplete", "off");
    filterInput.value = initialFilter;
    panel.appendChild(filterInput);

    const treeEl = document.createElement("div");
    treeEl.className = "emi-tree";
    panel.appendChild(treeEl);

    const btns = document.createElement("div");
    btns.className = "emi-btns";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "emi-btn refresh";
    refreshBtn.textContent = "↻ Refresh";
    refreshBtn.title = "Rescan the model folders (rebuild the cached list)";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "emi-btn";
    cancelBtn.textContent = "Cancel";

    const editBtn = document.createElement("button");
    editBtn.className = "emi-btn primary";
    editBtn.textContent = "Edit";
    editBtn.disabled = !selectedKey;

    btns.appendChild(refreshBtn);
    btns.appendChild(cancelBtn);
    btns.appendChild(editBtn);
    panel.appendChild(btns);

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    }

    function confirmEdit() {
        if (!selectedKey) return;
        const key = selectedKey;
        selectedKey = null;            // re-entry guard: confirm only once
        close();
        openModelInfo(key);
    }

    function select(key, rowEl) {
        selectedKey = key;
        editBtn.disabled = false;
        treeEl.querySelector(".emi-row.selected")?.classList.remove("selected");
        rowEl.classList.add("selected");
    }

    // Render one directory level; returns the element, or null when the filter
    // leaves nothing visible underneath it. Depth 0 renders the model branches.
    function renderDir(node, dirPath, term, forceExpand) {
        const frag = document.createDocumentFragment();
        let any = false;

        // Keep the branch order sent by the server at the top level; sort the
        // subdirs below it alphabetically.
        const dirEntries = dirPath
            ? [...node.dirs.entries()]
                .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
            : [...node.dirs.entries()];

        for (const [name, child] of dirEntries) {
            const childPath = dirPath ? `${dirPath}/${name}` : name;
            const childrenEl = renderDir(child, childPath, term, forceExpand);
            if (!childrenEl) continue;
            any = true;

            const isOpen = forceExpand || expanded.has(childPath);

            const row = document.createElement("div");
            row.className = dirPath ? "emi-row folder" : "emi-row folder branch";
            row.innerHTML = `<span class="emi-ico"></span><span></span>`;
            row.querySelector(".emi-ico").textContent = isOpen ? "▾" : "▸";
            row.querySelector("span:last-child").textContent = name;

            childrenEl.classList.toggle("collapsed", !isOpen);

            row.addEventListener("click", () => {
                const open = expanded.has(childPath);
                if (open) expanded.delete(childPath);
                else expanded.add(childPath);
                childrenEl.classList.toggle("collapsed", open);
                row.querySelector(".emi-ico").textContent = open ? "▸" : "▾";
            });

            frag.appendChild(row);
            frag.appendChild(childrenEl);
        }

        const files = term
            ? node.files.filter(f => f.name.toLowerCase().includes(term))
            : node.files;

        for (const file of files) {
            any = true;
            const row = document.createElement("div");
            row.className = "emi-row";
            row.innerHTML = `<span class="emi-ico">▤</span><span></span>`;
            row.querySelector("span:last-child").textContent = file.name.replace(/\.safetensors$/i, "");
            row.title = file.key;
            if (file.key === selectedKey) row.classList.add("selected");

            // Manual double-click detection: two clicks on the same file
            // within 400 ms confirm the edit (more reliable than the native
            // "dblclick" event, which the browser suppresses when the mouse
            // drifts slightly between clicks).
            row.addEventListener("click", () => {
                const now = Date.now();
                const isDouble = lastClick.key === file.key && now - lastClick.time < 400;
                lastClick = { key: file.key, time: now };
                select(file.key, row);
                if (isDouble) confirmEdit();
            });

            frag.appendChild(row);
        }

        if (!any) return null;
        const wrap = document.createElement("div");
        if (dirPath) wrap.className = "emi-children";
        wrap.appendChild(frag);
        return wrap;
    }

    function render() {
        const term = filterInput.value.trim().toLowerCase();
        treeEl.innerHTML = "";

        // Drop the selection if filtering hid the selected file.
        if (selectedKey && term && !selectedKey.toLowerCase().includes(term)) {
            selectedKey = null;
            editBtn.disabled = true;
        }

        const content = allKeys.size ? renderDir(tree, "", term, !!term) : null;
        if (content) {
            treeEl.appendChild(content);
        } else {
            const empty = document.createElement("div");
            empty.className = "emi-empty";
            empty.textContent = allKeys.size
                ? "No models match the filter."
                : "No .safetensors models found.";
            treeEl.appendChild(empty);
        }
    }

    const onKey = e => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if (e.key === "Enter" && !editBtn.disabled) { e.stopPropagation(); confirmEdit(); }
    };

    // Rescan the model folders, rebuilding the cached list, then reopen the
    // dialog with the fresh list. The current filter text is carried over.
    async function refresh() {
        refreshBtn.classList.add("busy");
        const term = filterInput.value;
        try {
            const fresh = await fetchModelList(true);
            close();
            openModelDialog(fresh, term);
        } catch (err) {
            refreshBtn.classList.remove("busy");
            console.error("[EditModelInfo] failed to refresh models:", err);
            toast("error", "Refresh failed", `Could not rescan the models: ${err.message ?? err}`);
        }
    }

    filterInput.addEventListener("input", render);
    refreshBtn.addEventListener("click", refresh);
    cancelBtn.addEventListener("click", close);
    editBtn.addEventListener("click", confirmEdit);
    overlay.addEventListener("pointerdown", e => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);

    render();
    document.body.appendChild(overlay);
    // Bring the remembered selection into view (works only once attached).
    treeEl.querySelector(".emi-row.selected")?.scrollIntoView({ block: "center" });
    filterInput.focus();
}

// ── Template chooser dialog ───────────────────────────────────────────────────
// Shown when the selected model has no .txt yet: pick one of the templates in
// ntx_data/modeldata; the server copies it next to the model and opens it.

function openTemplateChooser(modelKey, templates) {
    injectStyles();
    document.querySelector(".emi-overlay")?.remove();

    let selectedTemplate = null;
    let lastClick = { name: null, time: 0 };

    const overlay = document.createElement("div");
    overlay.className = "emi-overlay";

    const panel = document.createElement("div");
    panel.className = "emi-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "emi-title";
    title.innerHTML = `Create model info file<small></small>`;
    title.querySelector("small").textContent =
        `No .txt exists for "${splitKey(modelKey).model_name}" — select a template (ntx_data/modeldata)`;
    panel.appendChild(title);

    const treeEl = document.createElement("div");
    treeEl.className = "emi-tree";
    panel.appendChild(treeEl);

    const btns = document.createElement("div");
    btns.className = "emi-btns";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "emi-btn";
    cancelBtn.textContent = "Cancel";

    const createBtn = document.createElement("button");
    createBtn.className = "emi-btn primary";
    createBtn.textContent = "Create";
    createBtn.disabled = true;

    btns.appendChild(cancelBtn);
    btns.appendChild(createBtn);
    panel.appendChild(btns);

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    }

    function confirmCreate() {
        if (!selectedTemplate) return;
        const template = selectedTemplate;
        selectedTemplate = null;       // re-entry guard: confirm only once
        close();
        openModelInfo(modelKey, template);
    }

    for (const name of templates) {
        const row = document.createElement("div");
        row.className = "emi-row";
        row.innerHTML = `<span class="emi-ico">▤</span><span></span>`;
        row.querySelector("span:last-child").textContent = name.replace(/\.txt$/i, "");
        row.title = name;

        row.addEventListener("click", () => {
            const now = Date.now();
            const isDouble = lastClick.name === name && now - lastClick.time < 400;
            lastClick = { name, time: now };
            selectedTemplate = name;
            createBtn.disabled = false;
            treeEl.querySelector(".emi-row.selected")?.classList.remove("selected");
            row.classList.add("selected");
            if (isDouble) confirmCreate();
        });

        treeEl.appendChild(row);
    }

    const onKey = e => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if (e.key === "Enter" && !createBtn.disabled) { e.stopPropagation(); confirmCreate(); }
    };

    cancelBtn.addEventListener("click", close);
    createBtn.addEventListener("click", confirmCreate);
    overlay.addEventListener("pointerdown", e => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(overlay);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function showModelPicker() {
    try {
        const branches = await fetchModelList();
        openModelDialog(branches);
    } catch (err) {
        console.error("[EditModelInfo] failed to list models:", err);
        toast("error", "Edit model info", `Could not list the models: ${err.message ?? err}`);
    }
}

// Grouped into the addon section of both RMB menus — over a node and over the
// empty canvas — so the option is reachable from anywhere.
const menuItem = () => [{
    content: "📝 Edit model info",
    callback: () => showModelPicker(),
}];

registerNodeMenu(menuItem);
registerCanvasMenu(menuItem);
