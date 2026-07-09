// CREATED WITH CLAUDE

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

import { ADDON_PREFIX, API_PREFIX } from "./config.js";
import { registerNodeMenu } from "./menu.js";

const NODE_ID = ADDON_PREFIX + "ModelInfo";
const MODEL_NAME_WIDGET = "model_name";

// widgets that get_modelinfo_data may fill; anything the response omits is
// reported to the user and left at its current value
const FILLABLE_WIDGETS = [
    "clip_name",
    "clip_name_2",
    "clip_name_3",
    "vae_name",
    "clip_skip",
    "shift",
    "guidance",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "model_prompt_positive",
    "model_prompt_negative",
    "notes",
];

function notify(severity, summary, detail) {
    try {
        app.extensionManager?.toast?.add({ severity, summary, detail, life: 6000 });
    } catch (err) {
        console.log(`${summary}: ${detail}`);
    }
}

async function loadModelInfo(node) {
    const modelNameWidget = node.widgets?.find((w) => w.name === MODEL_NAME_WIDGET);
    if (!modelNameWidget) return;

    const modelName = modelNameWidget.value;
    if (!modelName) {
        notify("warn", "Load Model Info", "No model selected.");
        return;
    }

    let data;
    try {
        const resp = await api.fetchApi(`/${API_PREFIX}/get_modelinfo_data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model_name: modelName }),
        });
        data = await resp.json();
    } catch (err) {
        console.error("ModelInfo : failed to load model info", err);
        notify("error", "Load Model Info", "Failed to reach the server.");
        return;
    }

    if (data === null) {
        notify("warn", "Load Model Info", "Data not available for the model. The values of the node were not changed.");
        return;
    }

    const missing = [];
    let changed = false;
    for (const name of FILLABLE_WIDGETS) {
        const widget = node.widgets?.find((w) => w.name === name);
        if (!widget) continue;
        if (Object.prototype.hasOwnProperty.call(data, name) && data[name] !== null) {
            widget.value = data[name];
            widget.callback?.(widget.value);
            changed = true;
        } else {
            missing.push(widget.label ?? name);
        }
    }
    if (changed) node.setDirtyCanvas(true, true);

    if (missing.length === 0) {
        notify("success", "Load Model Info", "All fields were loaded.");
    } else {
        notify("warn", "Load Model Info", `No data found for: ${missing.join(", ")}. Existing values were kept.`);
    }
}

async function saveModelInfo(node) {
    const values = {};
    for (const widget of node.widgets ?? []) {
        values[widget.name] = widget.value;
    }

    let data;
    try {
        const resp = await api.fetchApi(`/${API_PREFIX}/save_modelinfo_data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(values),
        });
        data = await resp.json();
    } catch (err) {
        console.error("ModelInfo : failed to save model info", err);
        notify("error", "Save Model Info", "Failed to reach the server.");
        return;
    }

    notify("success", "Save Model Info", data?.message ?? "OK");
}

registerNodeMenu((node) => {
    if (node?.comfyClass !== NODE_ID) return [];
    return [
        {
            content: "Load Model Info",
            callback: () => loadModelInfo(node),
        },
        {
            content: "Save Model Info",
            callback: () => saveModelInfo(node),
        },
    ];
});
