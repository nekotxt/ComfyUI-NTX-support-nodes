// CREATED WITH CLAUDE

// Adds a read-only result widget to the ReplaceTextParameters node, updated
// with the formatted text each time the node is executed. The widget is
// frontend-only: the backend sends the text via ui.PreviewText.
//
// The widget is a plain 'customtext' textarea, whose default styling
// (.comfy-multiline-input) paints it with --comfy-input-bg and so makes it read
// as an editable field. Here it is only a result display, so the background is
// made transparent (the node body shows through) and the caret/selection
// affordances are dropped.
//
// Both widgets of the node are DOM widgets, and the layout engine shares the
// node's free space between them, so by default the result grows with the node
// too. Pinning its computeLayoutSize() minHeight and maxHeight to a single row
// (options.getMinHeight / options.getMaxHeight, which the DOM widget reads)
// takes it out of the distribution: it always gets exactly one row, and the
// text field, whose max height is unbounded, absorbs all the rest.

import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_ID = ADDON_PREFIX + "ReplaceTextParameters";
const FALLBACK_ROW_HEIGHT = 20; // used until the textarea is mounted and styled

// Height of one line of text in the widget, in unscaled node units: the DOM
// widget is sized in those units and only then transform-scaled, so the
// element's computed style is in the same units computeLayoutSize() expects.
function rowHeight(element) {
    const styles = getComputedStyle(element);

    const lineHeight = parseFloat(styles.lineHeight); // NaN while 'normal'
    if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;

    const fontSize = parseFloat(styles.fontSize);
    if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * 1.2;

    return FALLBACK_ROW_HEIGHT;
}

app.registerExtension({
    name: API_PREFIX + ".text.replace_text_parameters",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_ID) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, []);

            const resultWidget = ComfyWidgets["STRING"](
                this,
                "result",
                ["STRING", { multiline: true }],
                app
            ).widget;

            resultWidget.label = "result";
            resultWidget.options.read_only = true;
            resultWidget.options.serialize = false;
            resultWidget.element.readOnly = true;
            resultWidget.serialize = false;

            // Flat display: no input frame, node colour behind the text.
            Object.assign(resultWidget.element.style, {
                backgroundColor: "transparent",
                border: "none",
                outline: "none",
                boxShadow: "none",
                color: "var(--input-text)",
                caretColor: "transparent",
                cursor: "default",
                padding: "0",
                whiteSpace: "pre",   // one row: never wrap onto a second line
                overflow: "hidden",
            });
            resultWidget.element.rows = 1;

            // Never draw the low-zoom placeholder: it is a WIDGET_BGCOLOR rect,
            // i.e. the very frame this widget is styled to not have.
            resultWidget.options.hideOnZoom = false;

            // One row, plus the widget margin the layout adds around the
            // element on both sides. Read lazily: the textarea has no computed
            // style until it is mounted, which happens after onNodeCreated.
            const resultHeight = () =>
                Math.ceil(rowHeight(resultWidget.element)) + 2 * resultWidget.margin;
            resultWidget.options.getMinHeight = resultHeight;
            resultWidget.options.getMaxHeight = resultHeight;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, [message]);

            const resultWidget = this.widgets?.find((w) => w.name === "result");
            if (!resultWidget) return;

            const text = message.text ?? "";
            resultWidget.value = Array.isArray(text) ? text.join("\n\n") : text;
        };
    },
});
