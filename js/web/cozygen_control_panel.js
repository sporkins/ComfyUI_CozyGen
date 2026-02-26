import { app } from "../../scripts/app.js";

const PANEL_NODE_TYPE = "CozyGenControlPanel";
const PRIORITY_MANAGER_NODE_TYPE = "CozyGenPriorityManager";

const WIDGET_NAME_MAP = {
    CozyGenBoolInput: ["value"],
    CozyGenFloatInput: ["default_value"],
    CozyGenSimpleFloatInput: ["value"],
    CozyGenIntInput: ["default_value"],
    CozyGenSimpleIntInput: ["value"],
    CozyGenSeedInput: ["seed"],
    CozyGenRandomNoiseInput: ["noise_seed"],
    CozyGenStringInput: ["default_value"],
    CozyGenChoiceInput: ["default_choice"],
    CozyGenLoraInput: ["lora_value", "strength_value"],
    CozyGenWanVideoModelSelector: ["model_name", "base_precision", "quantization", "load_device"],
    CozyGenWanVideoWrapperModelSelector: ["model_name", "base_precision", "quantization", "load_device"],
    CozyGenGGUFLoaderKJModelSelector: ["model_name", "extra_model_name", "dequant_dtype", "patch_dtype", "patch_on_device", "enable_fp16_accumulation", "attention_override"],
    CozyGenDynamicInput: ["default_value"],
    CozyGenImageInput: ["image"],
};

const META_WIDGET_NAMES = new Set([
    "param_name",
    "priority",
    "min_value",
    "max_value",
    "step",
    "add_randomize_toggle",
    "display_multiline",
    "choice_type",
    "display_bypass",
    "Multiline",
    "randomize_seed",
]);

function findWidget(node, name) {
    if (!node?.widgets) return null;
    return node.widgets.find((widget) => widget.name === name) || null;
}

function getGraphNodes(panelNode) {
    return panelNode?.graph?._nodes || app?.graph?._nodes || [];
}

function isControlPanelEligible(node) {
    if (!node || !node.widgets || typeof node.type !== "string") return false;
    if (!node.type.startsWith("CozyGen")) return false;
    if (node.type === PANEL_NODE_TYPE || node.type === PRIORITY_MANAGER_NODE_TYPE) return false;
    if (node.type.includes("Output") || node.type === "CozyGenMetaText" || node.type === "CozyGenEnd" || node.type === "CozyGenConditionalInterrupt") {
        return false;
    }
    return !!findWidget(node, "param_name");
}

function toPriorityNumber(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 999999 : parsed;
}

function getParamName(node) {
    return String(findWidget(node, "param_name")?.value ?? node.title ?? node.type ?? "Unnamed").trim();
}

function getWidgetNamesForNode(node) {
    if (node.type === "CozyGenLoraInputMulti") {
        const names = ["num_loras"];
        for (let idx = 0; idx < 5; idx += 1) {
            const loraWidget = findWidget(node, `lora_${idx}`);
            const strengthWidget = findWidget(node, `strength_${idx}`);
            if (loraWidget && !loraWidget.hidden) names.push(`lora_${idx}`);
            if (strengthWidget && !strengthWidget.hidden) names.push(`strength_${idx}`);
        }
        return names;
    }

    const explicitNames = WIDGET_NAME_MAP[node.type];
    if (Array.isArray(explicitNames)) {
        return explicitNames;
    }

    // Fallback for future Cozy input nodes: include visible non-meta widgets.
    return (node.widgets || [])
        .filter((widget) => widget && !widget.hidden && widget.type !== "button" && !META_WIDGET_NAMES.has(widget.name))
        .map((widget) => widget.name);
}

function resolveControlWidgets(node) {
    const widgetNames = getWidgetNamesForNode(node);
    const widgets = [];
    for (const widgetName of widgetNames) {
        const widget = findWidget(node, widgetName);
        if (!widget) continue;
        if (widget.hidden) continue;
        if (widget.type === "button") continue;
        widgets.push(widget);
    }
    return widgets;
}

function collectRows(panelNode) {
    const rows = [];
    const unsupported = [];
    for (const node of getGraphNodes(panelNode)) {
        if (!isControlPanelEligible(node)) continue;
        const paramName = getParamName(node);
        const priority = toPriorityNumber(findWidget(node, "priority")?.value);
        const widgets = resolveControlWidgets(node);
        if (!widgets.length) {
            unsupported.push(`${paramName || node.type} (${node.type})`);
            continue;
        }
        rows.push({
            node,
            id: node.id,
            type: node.type,
            paramName,
            priority,
            widgets,
        });
    }

    rows.sort((a, b) =>
        (a.priority - b.priority) ||
        a.paramName.localeCompare(b.paramName) ||
        (a.id - b.id)
    );

    return { rows, unsupported };
}

function readComboValues(widget) {
    const values = widget?.options?.values;
    if (Array.isArray(values)) return values.map((v) => String(v));
    if (typeof values === "function") {
        try {
            const resolved = values();
            if (Array.isArray(resolved)) return resolved.map((v) => String(v));
        } catch (error) {
            console.warn("CozyGen Control Panel: failed to resolve combo values.", error);
        }
    }
    return [String(widget?.value ?? "")];
}

function persistWidgetValue(node, widget, value) {
    const oldValue = widget.value;
    widget.value = value;

    node.properties = node.properties || {};
    node.properties[widget.name] = value;

    if (Array.isArray(node.widgets_values)) {
        const index = node.widgets.indexOf(widget);
        if (index >= 0) {
            node.widgets_values[index] = value;
        }
    }

    try {
        widget.callback?.(value, app?.canvas, node, widget);
    } catch (error) {
        console.warn(`CozyGen Control Panel: widget callback failed for ${widget.name}.`, error);
    }

    try {
        node.onWidgetChanged?.(widget.name, value, oldValue, widget);
    } catch (error) {
        console.warn(`CozyGen Control Panel: onWidgetChanged failed for ${widget.name}.`, error);
    }

    node.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function humanizeWidgetName(name) {
    if (!name) return "Value";
    return String(name)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function isIntegerWidget(widget) {
    if (widget?.options?.precision === 0) return true;
    const step = Number(widget?.options?.step);
    return Number.isFinite(step) && Math.abs(step % 1) < 1e-9;
}

function buildWidgetControl(panelNode, row, widget) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "4px";
    wrapper.style.minWidth = "0";
    wrapper.style.flex = "1 1 220px";

    const label = document.createElement("label");
    label.textContent = humanizeWidgetName(widget.name);
    label.style.fontSize = "11px";
    label.style.color = "#94a3b8";
    wrapper.appendChild(label);

    const widgetType = String(widget.type || "").toLowerCase();
    const options = widget.options || {};

    const refreshAfterCommit = widget.name === "num_loras" || row.type === "CozyGenDynamicInput";

    const commit = (value) => {
        persistWidgetValue(row.node, widget, value);
        if (refreshAfterCommit) {
            requestAnimationFrame(() => refreshPanel(panelNode));
        }
    };

    if (widgetType === "combo") {
        const select = document.createElement("select");
        select.style.width = "100%";
        select.style.padding = "6px";
        select.style.background = "#111827";
        select.style.color = "#e5e7eb";
        select.style.border = "1px solid #374151";
        select.style.borderRadius = "6px";
        select.style.fontSize = "12px";

        const values = readComboValues(widget);
        for (const optionValue of values) {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = optionValue;
            select.appendChild(option);
        }
        select.value = String(widget.value ?? "");
        if (!values.includes(select.value) && values.length > 0) {
            select.value = values[0];
        }
        select.addEventListener("change", () => commit(select.value));
        wrapper.appendChild(select);
        return wrapper;
    }

    if (widgetType === "toggle") {
        const rowEl = document.createElement("label");
        rowEl.style.display = "flex";
        rowEl.style.alignItems = "center";
        rowEl.style.gap = "8px";
        rowEl.style.padding = "6px";
        rowEl.style.background = "#111827";
        rowEl.style.border = "1px solid #374151";
        rowEl.style.borderRadius = "6px";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(widget.value);
        checkbox.addEventListener("change", () => commit(checkbox.checked));

        const text = document.createElement("span");
        text.textContent = checkbox.checked ? "On" : "Off";
        text.style.fontSize = "12px";
        text.style.color = "#e5e7eb";
        checkbox.addEventListener("change", () => {
            text.textContent = checkbox.checked ? "On" : "Off";
        });

        rowEl.appendChild(checkbox);
        rowEl.appendChild(text);
        wrapper.appendChild(rowEl);
        return wrapper;
    }

    if (widgetType === "number" || typeof widget.value === "number") {
        const input = document.createElement("input");
        input.type = "number";
        input.value = String(widget.value ?? "");
        input.style.width = "100%";
        input.style.padding = "6px";
        input.style.background = "#111827";
        input.style.color = "#e5e7eb";
        input.style.border = "1px solid #374151";
        input.style.borderRadius = "6px";
        input.style.fontSize = "12px";

        if (Number.isFinite(Number(options.min))) input.min = String(options.min);
        if (Number.isFinite(Number(options.max))) input.max = String(options.max);
        if (Number.isFinite(Number(options.step)) && Number(options.step) !== 0) input.step = String(options.step);

        input.addEventListener("change", () => {
            if (input.value === "") return;
            const parsed = isIntegerWidget(widget) ? Number.parseInt(input.value, 10) : Number.parseFloat(input.value);
            if (Number.isNaN(parsed)) return;
            commit(parsed);
        });
        wrapper.appendChild(input);
        return wrapper;
    }

    const multiline = Boolean(options.multiline);
    if (multiline) {
        const textarea = document.createElement("textarea");
        textarea.value = String(widget.value ?? "");
        textarea.rows = 3;
        textarea.style.width = "100%";
        textarea.style.minHeight = "64px";
        textarea.style.resize = "vertical";
        textarea.style.padding = "6px";
        textarea.style.background = "#111827";
        textarea.style.color = "#e5e7eb";
        textarea.style.border = "1px solid #374151";
        textarea.style.borderRadius = "6px";
        textarea.style.fontSize = "12px";
        textarea.style.fontFamily = "monospace";
        textarea.addEventListener("change", () => commit(textarea.value));
        wrapper.appendChild(textarea);
        return wrapper;
    }

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = String(widget.value ?? "");
    textInput.style.width = "100%";
    textInput.style.padding = "6px";
    textInput.style.background = "#111827";
    textInput.style.color = "#e5e7eb";
    textInput.style.border = "1px solid #374151";
    textInput.style.borderRadius = "6px";
    textInput.style.fontSize = "12px";
    textInput.addEventListener("change", () => commit(textInput.value));
    wrapper.appendChild(textInput);
    return wrapper;
}

function jumpToNode(node) {
    try {
        app?.canvas?.centerOnNode?.(node);
        if (typeof app?.canvas?.selectNode === "function") {
            app.canvas.selectNode(node, false);
        }
    } catch {
        // Best effort only
    }
}

function renderRows(panelNode) {
    const state = panelNode.__cozyControlPanelState;
    if (!state?.listEl) return;

    const { rows, unsupported } = collectRows(panelNode);
    state.rows = rows;
    state.unsupported = unsupported;

    state.summaryEl.textContent = `${rows.length} Cozy input node${rows.length === 1 ? "" : "s"} mirrored`;
    if (unsupported.length > 0) {
        state.warningEl.style.display = "block";
        state.warningEl.textContent = `Skipped ${unsupported.length} Cozy node${unsupported.length === 1 ? "" : "s"} with no mirrorable value widgets.`;
    } else {
        state.warningEl.style.display = "none";
        state.warningEl.textContent = "";
    }

    state.listEl.innerHTML = "";

    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "No Cozy input nodes found. Add Cozy inputs, then click Refresh.";
        empty.style.fontSize = "12px";
        empty.style.color = "#94a3b8";
        empty.style.padding = "4px";
        state.listEl.appendChild(empty);
        return;
    }

    for (const row of rows) {
        const card = document.createElement("div");
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.gap = "8px";
        card.style.padding = "8px";
        card.style.background = "#111827";
        card.style.border = "1px solid #1f2937";
        card.style.borderRadius = "8px";

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.gap = "8px";
        header.style.flexWrap = "wrap";

        const title = document.createElement("div");
        title.style.flex = "1 1 220px";
        title.style.minWidth = "0";

        const nameEl = document.createElement("div");
        nameEl.textContent = row.paramName || row.type;
        nameEl.style.color = "#e5e7eb";
        nameEl.style.fontSize = "13px";
        nameEl.style.fontWeight = "700";
        nameEl.style.wordBreak = "break-word";
        title.appendChild(nameEl);

        const metaEl = document.createElement("div");
        metaEl.textContent = `${row.type} • priority ${row.priority}`;
        metaEl.style.color = "#94a3b8";
        metaEl.style.fontSize = "11px";
        metaEl.style.wordBreak = "break-word";
        title.appendChild(metaEl);

        header.appendChild(title);

        const jumpBtn = document.createElement("button");
        jumpBtn.textContent = "Jump";
        jumpBtn.style.padding = "4px 8px";
        jumpBtn.style.fontSize = "11px";
        jumpBtn.style.cursor = "pointer";
        jumpBtn.addEventListener("click", () => jumpToNode(row.node));
        header.appendChild(jumpBtn);

        card.appendChild(header);

        const controls = document.createElement("div");
        controls.style.display = "flex";
        controls.style.flexWrap = "wrap";
        controls.style.gap = "8px";

        for (const widget of row.widgets) {
            controls.appendChild(buildWidgetControl(panelNode, row, widget));
        }

        card.appendChild(controls);
        state.listEl.appendChild(card);
    }
}

function updateLayout(node) {
    const state = node.__cozyControlPanelState;
    if (!state?.containerEl) return;
    const height = Math.max(280, (node.size?.[1] || 520) - 42);
    state.containerEl.style.height = `${height}px`;
}

function refreshPanel(node) {
    if (!node?.__cozyControlPanelState) return;
    renderRows(node);
    updateLayout(node);
    node.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function ensureControlPanelUI(node) {
    if (node.__cozyControlPanelState) return node.__cozyControlPanelState;

    const state = {
        rows: [],
        unsupported: [],
        containerEl: null,
        summaryEl: null,
        warningEl: null,
        listEl: null,
        refreshScheduled: false,
    };

    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.padding = "8px";
    container.style.height = "100%";
    container.style.boxSizing = "border-box";
    container.style.background = "#0f172a";
    container.style.border = "1px solid #1f2937";
    container.style.borderRadius = "8px";
    state.containerEl = container;

    const title = document.createElement("div");
    title.textContent = "CozyGen Control Panel";
    title.style.fontSize = "13px";
    title.style.fontWeight = "700";
    title.style.color = "#e5e7eb";
    container.appendChild(title);

    const summary = document.createElement("div");
    summary.textContent = "Loading...";
    summary.style.fontSize = "12px";
    summary.style.color = "#94a3b8";
    state.summaryEl = summary;
    container.appendChild(summary);

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "6px";

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.flex = "1";
    refreshBtn.style.padding = "4px 8px";
    refreshBtn.style.fontSize = "12px";
    refreshBtn.style.cursor = "pointer";
    refreshBtn.addEventListener("click", () => refreshPanel(node));
    controls.appendChild(refreshBtn);

    const resizeBtn = document.createElement("button");
    resizeBtn.textContent = "Fit";
    resizeBtn.style.flex = "1";
    resizeBtn.style.padding = "4px 8px";
    resizeBtn.style.fontSize = "12px";
    resizeBtn.style.cursor = "pointer";
    resizeBtn.addEventListener("click", () => {
        node.size = [640, 720];
        updateLayout(node);
        node.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    });
    controls.appendChild(resizeBtn);

    container.appendChild(controls);

    const warning = document.createElement("div");
    warning.style.display = "none";
    warning.style.fontSize = "11px";
    warning.style.color = "#fde68a";
    warning.style.background = "#422006";
    warning.style.border = "1px solid #92400e";
    warning.style.borderRadius = "6px";
    warning.style.padding = "6px";
    state.warningEl = warning;
    container.appendChild(warning);

    const list = document.createElement("div");
    list.style.display = "block";
    list.style.flex = "1 1 auto";
    list.style.minHeight = "0";
    list.style.overflowY = "auto";
    list.style.overflowX = "hidden";
    list.style.paddingRight = "2px";
    state.listEl = list;
    container.appendChild(list);

    const domWidget = node.addDOMWidget("cozygen_control_panel_ui", "div", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 280,
        getMaxHeight: () => Math.max(280, Number(node.size?.[1] || 280) - 40),
    });
    domWidget.computeSize = function (width) {
        return [width, Math.max(280, Number(node.size?.[1] || 720) - 40)];
    };

    if (!node.__cozyControlPanelHasCustomSize) {
        node.size = [640, 720];
    }

    const originalOnResize = node.onResize;
    node.onResize = function () {
        if (node.__cozyControlPanelAutoSizedOnce) {
            node.__cozyControlPanelHasCustomSize = true;
        }
        originalOnResize?.apply(this, arguments);
        updateLayout(node);
    };

    const originalOnDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function () {
        originalOnDrawForeground?.apply(this, arguments);
        updateLayout(node);
    };

    node.__cozyControlPanelAutoSizedOnce = true;
    node.__cozyControlPanelState = state;
    updateLayout(node);
    return state;
}

function scheduleRefresh(node) {
    const state = ensureControlPanelUI(node);
    if (state.refreshScheduled) return;
    state.refreshScheduled = true;
    requestAnimationFrame(() => {
        state.refreshScheduled = false;
        refreshPanel(node);
    });
}

app.registerExtension({
    name: "cozygen.control_panel",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== PANEL_NODE_TYPE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            ensureControlPanelUI(this);
            scheduleRefresh(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            ensureControlPanelUI(this);
            scheduleRefresh(this);
        };

        const onAfterGraphConfigured = nodeType.prototype.onAfterGraphConfigured;
        nodeType.prototype.onAfterGraphConfigured = function () {
            onAfterGraphConfigured?.apply(this, arguments);
            ensureControlPanelUI(this);
            scheduleRefresh(this);
            setTimeout(() => scheduleRefresh(this), 100);
            setTimeout(() => scheduleRefresh(this), 500);
        };
    },
});
