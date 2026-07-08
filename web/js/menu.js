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
        appendGroup(options, collect(canvasContributors, null));
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
