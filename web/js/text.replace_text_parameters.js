// CREATED WITH CLAUDE

// Adds a read-only result widget to the ReplaceTextParameters node, updated
// with the formatted text each time the node is executed. The widget is
// frontend-only: the backend sends the text via ui.PreviewText.

import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_ID = ADDON_PREFIX + "ReplaceTextParameters";

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
