// CREATED WITH CLAUDE

// Frontend of the DoublePrompt node: makes the split between the two
// multiline fields resizable.
//
// The layout engine distributes the node's free space among growable (DOM)
// widgets between their computeLayoutSize() minHeight/maxHeight, and the DOM
// widget implementation reads those bounds from options.getMinHeight /
// options.getMaxHeight. We store a split ratio in node.properties.split_ratio
// (serialized with the workflow) and cap both fields at ratio * free space,
// so the two caps always sum to the available space and the node can still be
// freely resized.
//
// Each textarea is inset by a 10px margin, so the ~20px band between the two
// fields belongs to the canvas: mouse events there reach the node, which is
// where the divider drag is picked up.

import { app } from "../../../scripts/app.js";
import { ADDON_PREFIX, API_PREFIX } from "./config.js";

const NODE_ID = ADDON_PREFIX + "DoublePrompt";
const MIN_FIELD_HEIGHT = 50; // matches the DOM widget default min height
const GRAB_MARGIN = 8;       // half-height of the divider hit band

function getPromptWidgets(node) {
    const pos = node.widgets?.find((w) => w.name === "prompt_positive");
    const neg = node.widgets?.find((w) => w.name === "prompt_negative");
    return pos && neg ? { pos, neg } : null;
}

// Node-local y of the boundary between the two fields (top of the negative
// widget's allocated area, i.e. the middle of the visual gap).
function dividerY(node) {
    const y = getPromptWidgets(node)?.neg.y;
    return typeof y === "number" && y > 0 ? y : null;
}

function inDividerBand(node, localY) {
    const y = dividerY(node);
    return y !== null && Math.abs(localY - y) <= GRAB_MARGIN;
}

app.registerExtension({
    name: API_PREFIX + ".text.double_prompt",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_ID) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, []);

            this.properties = this.properties ?? {};
            this.properties.split_ratio = this.properties.split_ratio ?? 0.5;

            const widgets = getPromptWidgets(this);
            if (!widgets) return;

            const node = this;
            // Share of node.freeWidgetSpace a field may grow to; both caps sum
            // to the free space, so the allocation fills the node exactly.
            const capHeight = (ratio) => {
                const free = node.freeWidgetSpace;
                if (typeof free !== "number" || free <= 0) return undefined;
                return Math.max(MIN_FIELD_HEIGHT, ratio * free);
            };
            widgets.pos.options.getMaxHeight = () =>
                capHeight(node.properties.split_ratio ?? 0.5);
            widgets.neg.options.getMaxHeight = () =>
                capHeight(1 - (node.properties.split_ratio ?? 0.5));
        };

        const onMouseDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function (e, pos, canvas) {
            if (onMouseDown?.apply(this, [e, pos, canvas])) return true;
            if (this.flags.collapsed || !inDividerBand(this, pos[1])) return false;

            const widgets = getPromptWidgets(this);
            if (!widgets) return false;

            const node = this;
            const startClientY = e.clientY;
            const startHeight = widgets.pos.computedHeight ?? MIN_FIELD_HEIGHT;
            const total = startHeight + (widgets.neg.computedHeight ?? MIN_FIELD_HEIGHT);

            const onMove = (ev) => {
                const scale = canvas.ds?.scale || 1;
                const height = Math.min(
                    Math.max(startHeight + (ev.clientY - startClientY) / scale, MIN_FIELD_HEIGHT),
                    total - MIN_FIELD_HEIGHT
                );
                node.properties.split_ratio = height / total;
                node.setDirtyCanvas(true, true);
            };
            // Capture phase: the canvas swallows pointerup (stopPropagation in
            // processMouseUp), so bubble-phase document listeners never fire.
            const onUp = () => {
                document.removeEventListener("pointermove", onMove, true);
                document.removeEventListener("pointerup", onUp, true);
                document.removeEventListener("pointercancel", onUp, true);
            };
            document.addEventListener("pointermove", onMove, true);
            document.addEventListener("pointerup", onUp, true);
            document.addEventListener("pointercancel", onUp, true);
            return true; // capture the click so the node is not dragged
        };

        // Double-click on the divider restores the even split.
        const onDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function (e, pos, canvas) {
            if (!this.flags.collapsed && inDividerBand(this, pos[1])) {
                this.properties.split_ratio = 0.5;
                this.setDirtyCanvas(true, true);
                return true;
            }
            return onDblClick?.apply(this, [e, pos, canvas]) ?? false;
        };

        // ns-resize cursor while hovering the divider.
        const onMouseMove = nodeType.prototype.onMouseMove;
        nodeType.prototype.onMouseMove = function (e, pos, canvas) {
            onMouseMove?.apply(this, [e, pos, canvas]);
            const hovering = !this.flags.collapsed && inDividerBand(this, pos[1]);
            if (hovering !== !!this._dividerHover) {
                this._dividerHover = hovering;
                canvas.canvas.style.cursor = hovering ? "ns-resize" : "";
                this.setDirtyCanvas(true, false);
            }
        };

        const onMouseLeave = nodeType.prototype.onMouseLeave;
        nodeType.prototype.onMouseLeave = function (e) {
            onMouseLeave?.apply(this, [e]);
            if (this._dividerHover) {
                this._dividerHover = false;
                app.canvas.canvas.style.cursor = "";
                this.setDirtyCanvas(true, false);
            }
        };

        // Grip dots so the divider is discoverable.
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            if (this.flags.collapsed) return;
            const y = dividerY(this);
            if (y === null) return;
            ctx.save();
            ctx.fillStyle = this._dividerHover ? "#ddd" : "#777";
            for (const dx of [-9, 0, 9]) {
                ctx.beginPath();
                ctx.arc(this.size[0] / 2 + dx, y, 1.7, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        };
    },
});
