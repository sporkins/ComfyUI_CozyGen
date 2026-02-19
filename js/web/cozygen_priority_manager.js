import { app } from "../../scripts/app.js";

const MANAGER_NODE_TYPE = "CozyGenPriorityManager";

function findWidget(node, name) {
    if (!node?.widgets) return null;
    return node.widgets.find((widget) => widget.name === name) || null;
}

function toInt(value, fallback = 999999) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
}

function isPrioritizableCozyNode(node) {
    if (!node || node.type === MANAGER_NODE_TYPE) return false;
    if (typeof node.type !== "string" || !node.type.startsWith("CozyGen")) return false;
    return !!findWidget(node, "param_name") && !!findWidget(node, "priority");
}

function collectRows(managerNode) {
    const graphNodes = managerNode?.graph?._nodes || app?.graph?._nodes || [];
    const rows = graphNodes
        .filter(isPrioritizableCozyNode)
        .map((node) => {
            const paramWidget = findWidget(node, "param_name");
            const priorityWidget = findWidget(node, "priority");
            const paramNameRaw = paramWidget?.value ?? "";
            const paramName = String(paramNameRaw).trim();
            const priority = toInt(priorityWidget?.value, 999999);
            return {
                node,
                id: node.id,
                type: node.type,
                title: node.title || node.type,
                paramName,
                priority,
                paramWidget,
                priorityWidget,
                duplicate: false,
            };
        })
        .sort((a, b) => (a.priority - b.priority) || (a.id - b.id));

    const counts = new Map();
    for (const row of rows) {
        if (!row.paramName) continue;
        counts.set(row.paramName, (counts.get(row.paramName) || 0) + 1);
    }

    const duplicates = new Set(
        Array.from(counts.entries())
            .filter(([, count]) => count > 1)
            .map(([name]) => name)
    );

    for (const row of rows) {
        row.duplicate = row.paramName ? duplicates.has(row.paramName) : false;
    }

    return {
        rows,
        duplicateNames: Array.from(duplicates).sort((a, b) => a.localeCompare(b)),
    };
}

function setNodePriority(node, priority) {
    const priorityWidget = findWidget(node, "priority");
    if (!priorityWidget) return;
    priorityWidget.value = priority;
    if (typeof priorityWidget.callback === "function") {
        priorityWidget.callback(priority, app?.canvas, node, priorityWidget);
    }
    node.properties = node.properties || {};
    node.properties.priority = priority;
    node.setDirtyCanvas?.(true, true);
}

function renderWarnings(state) {
    const warningEl = state.warningEl;
    if (!warningEl) return;
    if (!state.duplicateNames || state.duplicateNames.length === 0) {
        warningEl.style.display = "none";
        warningEl.textContent = "";
        return;
    }
    warningEl.style.display = "block";
    warningEl.textContent = `Duplicate param_name values: ${state.duplicateNames.join(", ")}. These can collide in Cozy form state.`;
}

function moveItem(array, fromIndex, toIndex) {
    const next = [...array];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}

function applyOrderedPriorities(node, shouldRefresh = true) {
    const state = node.__cozyPriorityState;
    if (!state) return;
    state.rows.forEach((row, index) => {
        setNodePriority(row.node, index);
        row.priority = index;
    });
    node.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
    if (shouldRefresh) {
        refreshManager(node);
    }
}

function renderRows(node) {
    const state = node.__cozyPriorityState;
    if (!state?.listEl) return;
    const listEl = state.listEl;
    listEl.innerHTML = "";

    if (!state.rows || state.rows.length === 0) {
        const empty = document.createElement("div");
        empty.style.fontSize = "12px";
        empty.style.color = "#9ca3af";
        empty.style.padding = "8px";
        empty.textContent = "No Cozy nodes with both param_name and priority found.";
        listEl.appendChild(empty);
        return;
    }

    state.rows.forEach((row, index) => {
        const item = document.createElement("div");
        item.draggable = true;
        item.style.display = "flex";
        item.style.flexDirection = "column";
        item.style.flex = "0 0 auto";
        item.style.gap = "4px";
        item.style.padding = "8px";
        item.style.marginBottom = "6px";
        item.style.border = row.duplicate ? "1px solid #ef4444" : "1px solid #334155";
        item.style.borderRadius = "6px";
        item.style.background = row.duplicate ? "#2b1717" : "#111827";
        item.style.cursor = "grab";
        item.dataset.index = String(index);

        const top = document.createElement("div");
        top.style.display = "flex";
        top.style.justifyContent = "space-between";
        top.style.alignItems = "center";

        const label = document.createElement("div");
        label.style.fontSize = "12px";
        label.style.fontWeight = "600";
        label.style.color = "#e5e7eb";
        label.textContent = `${index + 1}. ${row.paramName || "(empty param_name)"}`;
        top.appendChild(label);

        if (row.duplicate) {
            const badge = document.createElement("span");
            badge.textContent = "duplicate";
            badge.style.fontSize = "10px";
            badge.style.color = "#fecaca";
            badge.style.background = "#7f1d1d";
            badge.style.padding = "2px 6px";
            badge.style.borderRadius = "9999px";
            top.appendChild(badge);
        }

        const meta = document.createElement("div");
        meta.style.fontSize = "11px";
        meta.style.color = "#94a3b8";
        meta.textContent = `${row.type} | id ${row.id} | priority ${row.priority}`;

        item.appendChild(top);
        item.appendChild(meta);

        item.addEventListener("dragstart", (event) => {
            state.dragIndex = index;
            item.style.opacity = "0.5";
            event.dataTransfer.effectAllowed = "move";
        });

        item.addEventListener("dragend", () => {
            item.style.opacity = "1";
            state.dragIndex = null;
        });

        item.addEventListener("dragover", (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        });

        item.addEventListener("drop", (event) => {
            event.preventDefault();
            const fromIndex = state.dragIndex;
            const toIndex = index;
            if (fromIndex == null || fromIndex === toIndex) return;
            state.rows = moveItem(state.rows, fromIndex, toIndex);
            applyOrderedPriorities(node, true);
        });

        listEl.appendChild(item);
    });
}

function refreshManager(node) {
    const state = node.__cozyPriorityState;
    if (!state) return;
    const { rows, duplicateNames } = collectRows(node);
    state.rows = rows;
    state.duplicateNames = duplicateNames;
    state.summaryEl.textContent = `${rows.length} Cozy nodes found`;
    renderWarnings(state);
    renderRows(node);
    autoSizeNodeToContent(node);
    state.summaryEl.textContent = `${rows.length} Cozy nodes found (${state.listEl.childElementCount} rendered)`;
    updateManagerLayout(node);
    node.setDirtyCanvas?.(true, true);
}

function updateManagerLayout(node) {
    const state = node.__cozyPriorityState;
    if (!state?.listEl) return;
    if (!node.__cozyPriorityHasCustomSize) {
        state.listEl.style.height = "";
        state.listEl.style.maxHeight = "";
        state.listEl.style.minHeight = "0px";
        state.listEl.style.overflowY = "visible";
        return;
    }
    state.listEl.style.height = "";
    state.listEl.style.maxHeight = "";
    state.listEl.style.minHeight = "0px";
    state.listEl.style.overflowY = "auto";
}

function autoSizeNodeToContent(node) {
    const state = node.__cozyPriorityState;
    if (!state || node.__cozyPriorityHasCustomSize) return;
    const measureAndResize = () => {
        const container = state.containerEl;
        if (!container) return;
        const contentHeight = Math.ceil(container.scrollHeight + 24);
        const contentWidth = Math.ceil(container.scrollWidth + 24);
        const targetHeight = Math.max(520, contentHeight);
        const targetWidth = Math.max(520, Number(node.size?.[0] || 520), contentWidth);

        node.__cozyPriorityProgrammaticResize = true;
        if (typeof node.setSize === "function") {
            node.setSize([targetWidth, targetHeight]);
        } else {
            node.size = [targetWidth, targetHeight];
        }
        node.__cozyPriorityProgrammaticResize = false;
        node.__cozyPriorityAutoSizedOnce = true;
        updateManagerLayout(node);
    };

    requestAnimationFrame(() => requestAnimationFrame(measureAndResize));
}

function ensureManagerUI(node) {
    if (node.__cozyPriorityState) return node.__cozyPriorityState;

    const state = {
        rows: [],
        duplicateNames: [],
        dragIndex: null,
        summaryEl: null,
        warningEl: null,
        listEl: null,
        containerEl: null,
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
    title.style.fontSize = "13px";
    title.style.fontWeight = "700";
    title.style.color = "#e5e7eb";
    title.textContent = "Cozy Priority Manager";
    container.appendChild(title);

    const summary = document.createElement("div");
    summary.style.fontSize = "12px";
    summary.style.color = "#94a3b8";
    summary.textContent = "Loading...";
    container.appendChild(summary);
    state.summaryEl = summary;

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "6px";

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.flex = "1";
    refreshBtn.style.padding = "4px 8px";
    refreshBtn.style.fontSize = "12px";
    refreshBtn.style.cursor = "pointer";
    refreshBtn.addEventListener("click", () => refreshManager(node));
    controls.appendChild(refreshBtn);

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply Order";
    applyBtn.style.flex = "1";
    applyBtn.style.padding = "4px 8px";
    applyBtn.style.fontSize = "12px";
    applyBtn.style.cursor = "pointer";
    applyBtn.addEventListener("click", () => applyOrderedPriorities(node, true));
    controls.appendChild(applyBtn);

    container.appendChild(controls);

    const warning = document.createElement("div");
    warning.style.display = "none";
    warning.style.fontSize = "11px";
    warning.style.color = "#fecaca";
    warning.style.background = "#3f1d1d";
    warning.style.border = "1px solid #7f1d1d";
    warning.style.borderRadius = "6px";
    warning.style.padding = "6px";
    container.appendChild(warning);
    state.warningEl = warning;

    const list = document.createElement("div");
    list.style.display = "block";
    list.style.flex = "1 1 auto";
    list.style.minHeight = "0";
    list.style.width = "100%";
    list.style.overflowY = "visible";
    list.style.overflowX = "hidden";
    list.style.paddingRight = "2px";
    container.appendChild(list);
    state.listEl = list;

    const managerWidget = node.addDOMWidget("priority_manager_ui", "div", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 220,
        getMaxHeight: () => Math.max(220, Number(node.size?.[1] || 220) - 50),
    });
    managerWidget.computeSize = function (width) {
        return [width, Math.max(220, Number(node.size?.[1] || 220) - 50)];
    };
    if (!node.__cozyPriorityHasCustomSize) {
        node.size = [470, 520];
    }

    const originalOnResize = node.onResize;
    node.onResize = function () {
        if (!node.__cozyPriorityProgrammaticResize) {
            if (node.__cozyPriorityAutoSizedOnce) {
                node.__cozyPriorityHasCustomSize = true;
            }
        }
        originalOnResize?.apply(this, arguments);
        updateManagerLayout(node);
        requestAnimationFrame(() => updateManagerLayout(node));
    };

    const originalOnDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function () {
        originalOnDrawForeground?.apply(this, arguments);
        updateManagerLayout(node);
    };

    node.__cozyPriorityState = state;
    updateManagerLayout(node);
    return state;
}

app.registerExtension({
    name: "cozygen.priority_manager",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== MANAGER_NODE_TYPE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            ensureManagerUI(this);
            refreshManager(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            ensureManagerUI(this);
            refreshManager(this);
        };

        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            if (Array.isArray(options)) {
                options.unshift({
                    content: "Refresh Cozy Priorities",
                    callback: () => refreshManager(this),
                });
            }
            getExtraMenuOptions?.apply(this, arguments);
        };
    },
});
