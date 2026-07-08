// CREATED WITH CLAUDE FABLE 5

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerCanvasMenu } from "./menu.js";

// ── Configuration ─────────────────────────────────────────────────────────────
// Subdirectory (inside the ComfyUI user "workflows" folder) that is scanned for
// template workflows. Change this to point the picker somewhere else.
const TEMPLATES_SUBDIR = "ntx/_templates";

// Name of the throw-away workflow tab used while importing a template. The
// frontend appends ".json" and de-conflicts the path, so collisions with real
// workflows are not an issue.
const TEMP_TAB_NAME = "__wftemplate_temp__";

// When true, the template list is fetched from the server only once and reused
// for the rest of the session (new/renamed/deleted files won't show up until
// the page is reloaded). When false, the list is fetched on every menu open.
const CACHE_LIST = true;

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
.lwt-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 99998;
    display: flex;
    align-items: center;
    justify-content: center;
}

.lwt-panel {
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

.lwt-title {
    padding: 9px 12px;
    font-size: 13px;
    color: #eee;
    background: #252525;
    border-bottom: 1px solid #444;
    user-select: none;
}

.lwt-title small {
    display: block;
    margin-top: 2px;
    font-size: 10px;
    color: #777;
}

.lwt-filter {
    margin: 8px 10px 4px;
    padding: 5px 7px;
    background: #252525;
    border: 1px solid #444;
    border-radius: 3px;
    color: #ccc;
    font-size: 11px;
    outline: none;
}

.lwt-filter:focus {
    border-color: #4a90d9;
}

.lwt-tree {
    flex: 1 1 auto;
    overflow-y: auto;
    margin: 4px 4px 6px;
    padding: 0 6px;
    min-height: 120px;
}

.lwt-empty {
    padding: 24px 10px;
    text-align: center;
    color: #777;
}

.lwt-row {
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

.lwt-row:hover {
    background: rgba(255, 255, 255, 0.06);
}

.lwt-row.selected {
    background: rgba(74, 144, 217, 0.25);
    color: #fff;
}

.lwt-row .lwt-ico {
    flex: 0 0 auto;
    font-size: 10px;
    color: #888;
}

.lwt-row.folder .lwt-ico {
    color: #c9a44a;
}

.lwt-children {
    margin-left: 14px;
    border-left: 1px solid #333;
    padding-left: 4px;
}

.lwt-children.collapsed {
    display: none;
}

.lwt-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 10px;
    background: #252525;
    border-top: 1px solid #444;
}

.lwt-btn {
    padding: 5px 16px;
    background: #2a2a2a;
    color: #bbb;
    border: 1px solid #444;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
}

.lwt-btn:hover {
    background: #3a3a3a;
    color: #eee;
}

.lwt-btn.primary {
    background: #2c5687;
    border-color: #4a90d9;
    color: #fff;
}

.lwt-btn.primary:hover {
    background: #3a6ca7;
}

.lwt-btn:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
}

.lwt-btn.refresh {
    margin-right: auto;   /* push the confirm/cancel buttons to the right */
}

.lwt-btn.refresh.busy {
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

// ── Workflow listing ──────────────────────────────────────────────────────────

function toast(severity, summary, detail) {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 4000 });
}

let _templateListCache = null;

async function fetchTemplateList(force = false) {
    if (CACHE_LIST && _templateListCache && !force) return _templateListCache;

    const dir = `workflows/${TEMPLATES_SUBDIR}`;
    const resp = await api.fetchApi(
        `/userdata?dir=${encodeURIComponent(dir)}&recurse=true&split=false&full_info=false`
    );
    if (resp.status === 404) return [];           // directory doesn't exist yet
    if (!resp.ok) throw new Error(`userdata listing HTTP ${resp.status}`);
    const files = await resp.json();
    const paths = files
        .map(f => String(f).replaceAll("\\", "/"))
        .filter(f => f.toLowerCase().endsWith(".json"))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (CACHE_LIST) _templateListCache = paths;
    return paths;
}

// ── Workflow loading ──────────────────────────────────────────────────────────
// Strategy: open the template in a temporary workflow tab so the frontend's own
// loading pipeline builds every node and registers every subgraph definition,
// copy everything from that tab, switch back to the original tab, delete the
// temporary tab, and paste. The paste remaps node/link/subgraph ids (so nothing
// collides with existing content) and leaves the pasted items selected.

async function loadTemplate(relPath, dropPos) {
    const fullPath = `workflows/${TEMPLATES_SUBDIR}/${relPath}`;
    const resp = await api.fetchApi(`/userdata/${encodeURIComponent(fullPath)}`);
    if (!resp.ok) throw new Error(`userdata read HTTP ${resp.status}`);
    const graphData = await resp.json();

    const workflowStore = app.extensionManager?.workflow;
    if (!workflowStore?.activeWorkflow) throw new Error("no active workflow tab");
    const originalWorkflow = workflowStore.activeWorkflow;

    const loadOptions = { checkForRerouteMigration: false, deferWarnings: true };
    let tempWorkflow = null;
    let copiedItems = null;

    try {
        // 1. Passing a string as the `workflow` argument makes loadGraphData
        //    create and activate a brand-new temporary tab for the template.
        await app.loadGraphData(graphData, true, true, TEMP_TAB_NAME, loadOptions);
        tempWorkflow = workflowStore.activeWorkflow;
        if (tempWorkflow === originalWorkflow) tempWorkflow = null;

        // 2. Select everything in the temporary tab and serialise it. This is
        //    what copyToClipboard does, minus the localStorage write — big
        //    workflows can exceed the localStorage quota, so the copy is kept
        //    in memory instead (also leaves the real clipboard untouched).
        //    The serialisation embeds any (nested) subgraph definitions in use.
        app.canvas.selectItems();
        copiedItems = JSON.parse(JSON.stringify(app.canvas._serializeItems()));
    } finally {
        // 3. Switch back to the original tab — the same loadGraphData call the
        //    frontend's workflowService.openWorkflow makes for an already
        //    loaded workflow (activeState was snapshotted on tab switch).
        if (workflowStore.activeWorkflow !== originalWorkflow) {
            await app.loadGraphData(originalWorkflow.activeState, true, true, originalWorkflow, {
                ...loadOptions,
                skipAssetScans: true,
            });
        }

        // 4. Delete the temporary tab. The store-level close removes a
        //    temporary workflow outright, without any save-confirmation UI.
        if (tempWorkflow) await workflowStore.closeWorkflow(tempWorkflow);
    }

    // 5. Paste into the original tab (pasteFromClipboard minus the
    //    localStorage read); pasted items stay selected so the user can
    //    immediately drag them into place. `position` places the top-left
    //    corner of the pasted items' bounding box at the recorded mouse
    //    position (where the context menu was opened); without it the paste
    //    lands at the canvas' current graph_mouse.
    if (copiedItems) {
        app.canvas._deserializeItems(copiedItems, dropPos ? { position: dropPos } : {});
    }
}

// ── Tree model ────────────────────────────────────────────────────────────────
// Paths are relative to TEMPLATES_SUBDIR, e.g. "sdxl/portraits/base.json".

function buildTree(paths) {
    const root = { dirs: new Map(), files: [] };
    for (const p of paths) {
        const parts = p.split("/");
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!node.dirs.has(parts[i])) {
                node.dirs.set(parts[i], { dirs: new Map(), files: [] });
            }
            node = node.dirs.get(parts[i]);
        }
        node.files.push({ name: parts[parts.length - 1], path: p });
    }
    return root;
}

// ── Dialog ────────────────────────────────────────────────────────────────────

// Path of the template loaded most recently; when the dialog is reopened it is
// pre-selected again, with its parent folders expanded and scrolled into view.
let _lastLoadedPath = null;

function openTemplateDialog(paths, dropPos, initialFilter = "") {
    injectStyles();
    document.querySelector(".lwt-overlay")?.remove();

    const tree = buildTree(paths);
    const expanded = new Set();        // folder paths currently expanded
    let selectedPath = paths.includes(_lastLoadedPath) ? _lastLoadedPath : null;
    let lastClick = { path: null, time: 0 };   // manual double-click detection

    // Expand the folders on the way to the remembered selection.
    if (selectedPath) {
        const parts = selectedPath.split("/");
        let dirPath = "";
        for (let i = 0; i < parts.length - 1; i++) {
            dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i];
            expanded.add(dirPath);
        }
    }

    const overlay = document.createElement("div");
    overlay.className = "lwt-overlay";

    const panel = document.createElement("div");
    panel.className = "lwt-panel";
    overlay.appendChild(panel);

    const title = document.createElement("div");
    title.className = "lwt-title";
    title.innerHTML = `Load template workflow<small></small>`;
    title.querySelector("small").textContent = `workflows/${TEMPLATES_SUBDIR}`;
    panel.appendChild(title);

    const filterInput = document.createElement("input");
    filterInput.className = "lwt-filter";
    filterInput.type = "text";
    filterInput.placeholder = "Filter…";
    filterInput.setAttribute("autocomplete", "off");
    filterInput.value = initialFilter;
    panel.appendChild(filterInput);

    const treeEl = document.createElement("div");
    treeEl.className = "lwt-tree";
    panel.appendChild(treeEl);

    const btns = document.createElement("div");
    btns.className = "lwt-btns";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "lwt-btn refresh";
    refreshBtn.textContent = "↻ Refresh";
    refreshBtn.title = "Rescan the templates folder (rebuild the cached list)";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "lwt-btn";
    cancelBtn.textContent = "Cancel";

    const loadBtn = document.createElement("button");
    loadBtn.className = "lwt-btn primary";
    loadBtn.textContent = "Load";
    loadBtn.disabled = !selectedPath;

    btns.appendChild(refreshBtn);
    btns.appendChild(cancelBtn);
    btns.appendChild(loadBtn);
    panel.appendChild(btns);

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    }

    async function confirmLoad() {
        if (!selectedPath) return;
        const path = selectedPath;
        selectedPath = null;           // re-entry guard: confirm only once
        close();
        try {
            await loadTemplate(path, dropPos);
            _lastLoadedPath = path;    // remember for the next dialog open
        } catch (err) {
            console.error("[LoadWfTemplate] failed to load workflow:", err);
            toast("error", "Load failed", `Could not load "${path}": ${err.message ?? err}`);
        }
    }

    function select(path, rowEl) {
        selectedPath = path;
        loadBtn.disabled = false;
        treeEl.querySelector(".lwt-row.selected")?.classList.remove("selected");
        rowEl.classList.add("selected");
    }

    // Render one directory level; returns the element, or null when the filter
    // leaves nothing visible underneath it.
    function renderDir(node, dirPath, term, forceExpand) {
        const frag = document.createDocumentFragment();
        let any = false;

        const sortedDirs = [...node.dirs.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));

        for (const [name, child] of sortedDirs) {
            const childPath = dirPath ? `${dirPath}/${name}` : name;
            const childrenEl = renderDir(child, childPath, term, forceExpand);
            if (!childrenEl) continue;
            any = true;

            const isOpen = forceExpand || expanded.has(childPath);

            const row = document.createElement("div");
            row.className = "lwt-row folder";
            row.innerHTML = `<span class="lwt-ico"></span><span></span>`;
            row.querySelector(".lwt-ico").textContent = isOpen ? "▾" : "▸";
            row.querySelector("span:last-child").textContent = name;

            childrenEl.classList.toggle("collapsed", !isOpen);

            row.addEventListener("click", () => {
                const open = expanded.has(childPath);
                if (open) expanded.delete(childPath);
                else expanded.add(childPath);
                childrenEl.classList.toggle("collapsed", open);
                row.querySelector(".lwt-ico").textContent = open ? "▸" : "▾";
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
            row.className = "lwt-row";
            row.innerHTML = `<span class="lwt-ico">▤</span><span></span>`;
            row.querySelector("span:last-child").textContent = file.name.replace(/\.json$/i, "");
            row.title = file.path;
            if (file.path === selectedPath) row.classList.add("selected");

            // Manual double-click detection: two clicks on the same file
            // within 400 ms confirm the load. More reliable than the native
            // "dblclick" event, which the browser suppresses when the mouse
            // drifts slightly between clicks.
            row.addEventListener("click", () => {
                const now = Date.now();
                const isDouble = lastClick.path === file.path && now - lastClick.time < 400;
                lastClick = { path: file.path, time: now };
                select(file.path, row);
                if (isDouble) confirmLoad();
            });

            frag.appendChild(row);
        }

        if (!any) return null;
        const wrap = document.createElement("div");
        if (dirPath) wrap.className = "lwt-children";
        wrap.appendChild(frag);
        return wrap;
    }

    function render() {
        const term = filterInput.value.trim().toLowerCase();
        treeEl.innerHTML = "";

        // Drop the selection if filtering hid the selected file.
        if (selectedPath && term && !selectedPath.toLowerCase().includes(term)) {
            selectedPath = null;
            loadBtn.disabled = true;
        }

        const content = paths.length ? renderDir(tree, "", term, !!term) : null;
        if (content) {
            treeEl.appendChild(content);
        } else {
            const empty = document.createElement("div");
            empty.className = "lwt-empty";
            empty.textContent = paths.length
                ? "No workflows match the filter."
                : `No workflows found in workflows/${TEMPLATES_SUBDIR}`;
            treeEl.appendChild(empty);
        }
    }

    const onKey = e => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if (e.key === "Enter" && !loadBtn.disabled) { e.stopPropagation(); confirmLoad(); }
    };

    // Rescan the templates folder, rebuilding the cached list, then reopen the
    // dialog with the fresh paths. The current filter text is carried over; the
    // most recently loaded template stays pre-selected (via _lastLoadedPath).
    async function refresh() {
        refreshBtn.classList.add("busy");
        const term = filterInput.value;
        try {
            const fresh = await fetchTemplateList(true);
            close();
            openTemplateDialog(fresh, dropPos, term);
        } catch (err) {
            refreshBtn.classList.remove("busy");
            console.error("[LoadWfTemplate] failed to refresh workflows:", err);
            toast("error", "Refresh failed",
                `Could not rescan workflows/${TEMPLATES_SUBDIR}: ${err.message ?? err}`);
        }
    }

    filterInput.addEventListener("input", render);
    refreshBtn.addEventListener("click", refresh);
    cancelBtn.addEventListener("click", close);
    loadBtn.addEventListener("click", confirmLoad);
    overlay.addEventListener("pointerdown", e => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);

    render();
    document.body.appendChild(overlay);
    // Bring the remembered selection into view (works only once attached).
    treeEl.querySelector(".lwt-row.selected")?.scrollIntoView({ block: "center" });
    filterInput.focus();
}

async function showTemplatePicker(dropPos) {
    try {
        const paths = await fetchTemplateList();
        openTemplateDialog(paths, dropPos);
    } catch (err) {
        console.error("[LoadWfTemplate] failed to list workflows:", err);
        toast("error", "Scan failed",
            `Could not list workflows/${TEMPLATES_SUBDIR}: ${err.message ?? err}`);
    }
}

// ── Extension registration ────────────────────────────────────────────────────

app.registerExtension({
    name: API_PREFIX + ".load_template_workflow",

    // Registered command: shows up in the command palette and in
    // Settings → Keybinding, where the default shortcut can be rebound.
    commands: [{
        id: API_PREFIX + ".load_template_workflow.open",
        label: ADDON_PREFIX + " Load template workflow",
        icon: "pi pi-folder-open",
        // graph_mouse holds the last known canvas mouse position, so the
        // nodes are dropped where the mouse hovers when the shortcut is hit.
        function: () => showTemplatePicker([...app.canvas.graph_mouse]),
    }],

    keybindings: [{
        commandId: API_PREFIX + ".load_template_workflow.open",
        combo: { key: "w", alt: true },
    }],
});

// Canvas right-click menu entry, grouped into the addon submenu.
registerCanvasMenu(() => [{
    content: "🧷 Load template workflow",
    // Record the graph-space mouse position now (i.e. where the context menu
    // was opened); the inserted nodes are dropped there.
    callback: () => showTemplatePicker([...app.canvas.graph_mouse]),
}]);
