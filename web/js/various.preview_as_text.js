// CREATED WITH CLAUDE

// Frontend twin of the core 'Comfy.PreviewAny' extension, keyed to our
// PreviewAsText node id: the preview widgets are frontend-only, so without
// this the node executes but displays nothing.

import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_ID = ADDON_PREFIX + "PreviewAsText";

app.registerExtension({
    name: API_PREFIX + ".various.preview_as_text",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_ID) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, []);

            const markdownWidget = ComfyWidgets["MARKDOWN"](
                this,
                "preview_markdown",
                ["MARKDOWN", {}],
                app
            ).widget;

            const plainWidget = ComfyWidgets["STRING"](
                this,
                "preview_text",
                ["STRING", { multiline: true }],
                app
            ).widget;

            const modeWidget = ComfyWidgets["BOOLEAN"](
                this,
                "previewMode",
                ["BOOLEAN", { label_on: "Markdown", label_off: "Plaintext", default: false }],
                app
            );

            modeWidget.widget.callback = (value) => {
                markdownWidget.hidden = !value;
                markdownWidget.options.hidden = !value;
                plainWidget.hidden = value;
                plainWidget.options.hidden = value;
            };

            markdownWidget.label = "Preview";
            markdownWidget.hidden = true;
            markdownWidget.options.hidden = true;
            markdownWidget.options.read_only = true;
            markdownWidget.options.serialize = false;
            markdownWidget.element.readOnly = true;
            markdownWidget.serialize = false;

            plainWidget.label = "Preview";
            plainWidget.hidden = false;
            plainWidget.options.hidden = false;
            plainWidget.options.read_only = true;
            plainWidget.options.serialize = false;
            plainWidget.element.readOnly = true;
            plainWidget.serialize = false;

            // Frontend-only display preference; must not be serialized into the
            // API prompt (would alter the cache signature).
            modeWidget.widget.options.serialize = false;
        };

        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, [message]);

            const previewWidgets =
                this.widgets?.filter((w) => w.name.startsWith("preview_")) ?? [];

            for (const previewWidget of previewWidgets) {
                const text = message.text ?? "";
                previewWidget.value = Array.isArray(text)
                    ? (text?.join("\n\n") ?? "")
                    : text;
            }
        };
    },
});
