import { app } from "../../scripts/app.js";

const NODE_TYPE = "CozyGenLoraInputMulti";
const MAX_LORAS = 5;
const DEFAULT_LORAS = 5;
const HIDDEN_WIDGET_TYPE = "cozygen_hidden";

function findWidget(node, name) {
    if (!node?.widgets) return null;
    return node.widgets.find((widget) => widget.name === name) || null;
}

function clampLoraCount(value, maxCount = MAX_LORAS) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return DEFAULT_LORAS;
    return Math.max(1, Math.min(maxCount, parsed));
}

function setWidgetVisible(widget, visible) {
    if (!widget) return;
    if (visible) {
        if (widget.__cozyOrigType != null) {
            widget.type = widget.__cozyOrigType;
        }
        if (widget.__cozyOrigComputeSize) {
            widget.computeSize = widget.__cozyOrigComputeSize;
        }
        widget.hidden = false;
        return;
    }

    if (widget.__cozyOrigType == null) {
        widget.__cozyOrigType = widget.type;
    }
    if (!widget.__cozyOrigComputeSize) {
        widget.__cozyOrigComputeSize = widget.computeSize;
    }
    widget.type = HIDDEN_WIDGET_TYPE;
    widget.computeSize = () => [0, -4];
    widget.hidden = true;
}

function persistWidgetValue(node, widget, value) {
    if (!widget) return;
    widget.value = value;
    node.properties = node.properties || {};
    node.properties[widget.name] = value;
    if (Array.isArray(node.widgets_values)) {
        const widgetIndex = node.widgets?.indexOf(widget) ?? -1;
        if (widgetIndex >= 0) {
            node.widgets_values[widgetIndex] = value;
        }
    }
}

function inferConfiguredLoraPairs(node) {
    let highest = 0;
    for (let idx = 0; idx < MAX_LORAS; idx += 1) {
        const loraWidget = findWidget(node, `lora_${idx}`);
        const strengthWidget = findWidget(node, `strength_${idx}`);
        const loraName = String(loraWidget?.value ?? "None");
        const strength = Number(strengthWidget?.value ?? 0);
        if (loraName !== "None" && strength !== 0) {
            highest = idx + 1;
        }
    }
    return highest;
}

function applyNumLoras(node, requestedValue = null) {
    const numWidget = findWidget(node, "num_loras");
    if (!numWidget) return;

    const requestedPairs = clampLoraCount(
        requestedValue == null ? numWidget.value : requestedValue,
        MAX_LORAS
    );

    persistWidgetValue(node, numWidget, requestedPairs);

    for (let idx = 0; idx < MAX_LORAS; idx += 1) {
        const visible = idx < requestedPairs;
        setWidgetVisible(findWidget(node, `lora_${idx}`), visible);
        setWidgetVisible(findWidget(node, `strength_${idx}`), visible);
    }

    if (typeof node.computeSize === "function") {
        node.size = node.computeSize();
    }
    node.setDirtyCanvas?.(true, true);
}

function patchNumWidgetCallback(node) {
    const numWidget = findWidget(node, "num_loras");
    if (!numWidget || numWidget.__cozyNumLoraPatched) return;

    const originalCallback = numWidget.callback;
    numWidget.callback = (value, ...args) => {
        originalCallback?.(value, ...args);
        applyNumLoras(node, value);
    };
    numWidget.__cozyNumLoraPatched = true;
}

function setupLoraMultiNode(node) {
    patchNumWidgetCallback(node);

    const numWidget = findWidget(node, "num_loras");
    if (!numWidget) return;

    const inferredNum = inferConfiguredLoraPairs(node);
    if (!Number.isFinite(Number(numWidget.value)) || Number(numWidget.value) < 1) {
        persistWidgetValue(node, numWidget, inferredNum > 0 ? inferredNum : DEFAULT_LORAS);
    }

    applyNumLoras(node);
}

app.registerExtension({
    name: "cozygen.lora_input_multi",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            setupLoraMultiNode(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setupLoraMultiNode(this);
        };

        const onAfterGraphConfigured = nodeType.prototype.onAfterGraphConfigured;
        nodeType.prototype.onAfterGraphConfigured = function () {
            onAfterGraphConfigured?.apply(this, arguments);
            setupLoraMultiNode(this);
        };

        const onWidgetChanged = nodeType.prototype.onWidgetChanged;
        nodeType.prototype.onWidgetChanged = function (name, value, oldValue, widget) {
            const result = onWidgetChanged?.apply(this, arguments);
            const widgetName = widget?.name ?? name;
            if (widgetName === "num_loras") {
                applyNumLoras(this, value);
            }
            return result;
        };

        const onPropertyChanged = nodeType.prototype.onPropertyChanged;
        nodeType.prototype.onPropertyChanged = function (name, value, prevValue) {
            const result = onPropertyChanged?.apply(this, arguments);
            if (name === "num_loras") {
                applyNumLoras(this, value);
            }
            return result;
        };
    },
});
