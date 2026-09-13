// CREATED WITH CLAUDE
//
// Central RMB (right-click) menu grouping for the whole addon.
//
// Every addon menu entry used to be pushed straight onto LiteGraph's node or
// canvas context menu from its own feature file, so the entries ended up
// scattered among the native menu items. Instead each feature file now
// registers its entries here, and this module injects them all under a single
// submenu named after ADDON_NAME (config.js) — one tidy section per menu.
//
// Feature files call registerNodeMenu()/registerCanvasMenu() at import time
// with a contributor function:
//   - node contributors receive the right-clicked node and return the menu
//     items to show for it (or an empty array when they don't apply to it),
//   - canvas contributors take no argument and return the empty-canvas items.
// A contributor may return a single item or an array of items; falsy results
// are ignored.
//
// The canvas section additionally starts with a built-in "Add node" entry that
// opens the addon's own node tree (the same one found under the native
// "Add Node" > ADDON_NAME submenu), so the addon's nodes can be added from the
// top-level canvas menu without digging through every installed pack.

import { app } from "../../../scripts/app.js";
import { ADDON_NAME, API_PREFIX } from "./config.js";

const nodeContributors = [];
const canvasContributors = [];

export function registerNodeMenu(fn) {
    if (typeof fn === "function") nodeContributors.push(fn);
}

export function registerCanvasMenu(fn) {
    if (typeof fn === "function") canvasContributors.push(fn);
}

// Run every contributor and flatten their results into one item list.
function collect(contributors, arg) {
    const items = [];
    for (const fn of contributors) {
        let produced;
        try {
            produced = fn(arg);
        } catch (err) {
            console.error(`[${ADDON_NAME}] menu contributor failed`, err);
            continue;
        }
        if (Array.isArray(produced)) {
            for (const item of produced) if (item) items.push(item);
        } else if (produced) {
            items.push(produced);
        }
    }
    return items;
}

// Append the collected items to a menu as one inline section: a separator, a
// greyed non-clickable header (a `disabled` item), then the items themselves —
// so every option stays directly visible instead of hidden behind a submenu.
function appendGroup(options, items) {
    if (!items.length) return;
    options.push(null);                                     // separator above the section
    options.push({ content: ADDON_NAME, disabled: true });  // section header
    for (const item of items) options.push(item);
    options.push(null);                                     // separator below the section
}

// Root category the python side registers every node under (ADDON_CATEGORY in
// config_variables.py, which equals ADDON_NAME) — with the trailing slash the
// litegraph category helpers expect for a path prefix.
const ROOT_CATEGORY = ADDON_NAME + "/";

const compareByContent = (a, b) =>
    (a.content ?? "").localeCompare(b.content ?? "", undefined, { numeric: true, sensitivity: "base" });

// Open a submenu listing the sub-categories and nodes found directly under
// `baseCategory` (a "path/" prefix). Mirrors the closure litegraph uses for its
// own "Add Node" menu (LGraphCanvas.onMenuAdd), which cannot be started from a
// category other than the root, so it is re-implemented here scoped to the
// addon's tree. Nodes are created at the position of the initial right-click.
function openAddNodeSubmenu(baseCategory, e, prevMenu) {
    const canvas = app.canvas;
    const graph = canvas?.graph;
    if (!graph) return;
    const filter = canvas.filter || graph.filter;

    const categoryEntries = [];
    for (const category of LiteGraph.getNodeTypesCategories(filter)) {
        if (!category.startsWith(baseCategory)) continue;
        const name = category.slice(baseCategory.length).split("/", 1)[0];
        if (!name) continue;
        const path = baseCategory + name + "/";
        if (categoryEntries.some((entry) => entry.value === path)) continue;
        categoryEntries.push({
            value: path,
            content: name,
            has_submenu: true,
            callback: (value, _event, _mouseEvent, contextMenu) =>
                openAddNodeSubmenu(value.value, e, contextMenu),
        });
    }
    categoryEntries.sort(compareByContent);

    const nodeEntries = [];
    for (const type of LiteGraph.getNodeTypesInCategory(baseCategory.slice(0, -1), filter)) {
        if (type.skip_list) continue;
        nodeEntries.push({
            value: type.type,
            content: type.title,
            has_submenu: false,
            callback: (value, _event, _mouseEvent, contextMenu) => {
                const firstEvent = contextMenu.getFirstEvent();
                graph.beforeChange();
                const node = LiteGraph.createNode(value.value);
                if (node) {
                    node.pos = canvas.convertEventToCanvasOffset(firstEvent);
                    graph.add(node);
                } else {
                    console.warn(`[${ADDON_NAME}] failed to create node of type:`, value.value);
                }
                graph.afterChange();
            },
        });
    }
    nodeEntries.sort(compareByContent);

    new LiteGraph.ContextMenu([...categoryEntries, ...nodeEntries], { event: e, parentMenu: prevMenu });
}

// The "Add node" entry that heads the addon's canvas section.
function addNodeEntry() {
    return {
        content: "Add node",
        has_submenu: true,
        callback: (_value, _options, e, prevMenu) => {
            openAddNodeSubmenu(ROOT_CATEGORY, e, prevMenu);
            return false;
        },
    };
}

let installed = false;
function installGroupedMenu() {
    const LGraphCanvas = window.LGraphCanvas || app.canvas?.constructor;
    if (installed || !LGraphCanvas?.prototype) return;
    installed = true;

    // Every node's RMB menu.
    const origNodeMenu = LGraphCanvas.prototype.getNodeMenuOptions;
    LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
        const options = origNodeMenu.apply(this, arguments);
        appendGroup(options, collect(nodeContributors, node));
        return options;
    };

    // The empty-canvas RMB menu (no node).
    const origCanvasMenu = LGraphCanvas.prototype.getCanvasMenuOptions;
    LGraphCanvas.prototype.getCanvasMenuOptions = function () {
        const options = origCanvasMenu.apply(this, arguments);
        appendGroup(options, [addNodeEntry(), ...collect(canvasContributors, null)]);
        return options;
    };
}

app.registerExtension({
    name: API_PREFIX + ".menu",
    // setup() runs after all feature files have imported and registered their
    // contributors, and after LGraphCanvas exists, so the patch is safe here.
    setup() {
        installGroupedMenu();
    },
});
