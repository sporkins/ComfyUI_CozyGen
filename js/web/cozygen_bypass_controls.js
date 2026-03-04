import { app } from "../../scripts/app.js";

const NODE_TYPE = "CozyGenBypassControls";

const FAST_BYPASSER_TYPES = new Set(["Fast Bypasser (rgthree)", "Fast Bypasser"]);
const FAST_GROUPS_TYPES = new Set([
    "Fast Groups Bypasser (rgthree)",
    "Fast Groups Bypasser",
    "Fast Groups Muter (rgthree)",
    "Fast Groups Muter",
]);

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function safeString(value, fallback = "") {
    if (value == null) return fallback;
    return String(value);
}

function getNodeClassType(node) {
    return safeString(node?.comfyClass || node?.type, "");
}

function getAllGraphs() {
    const root = app?.graph;
    if (!root) return [];
    const graphs = [root];
    const subgraphs = root.subgraphs;
    if (subgraphs && typeof subgraphs.values === "function") {
        for (const subgraph of subgraphs.values()) {
            if (subgraph) {
                graphs.push(subgraph);
            }
        }
    }
    return graphs;
}

function getAllNodes() {
    const nodes = [];
    for (const graph of getAllGraphs()) {
        for (const node of asArray(graph?._nodes || graph?.nodes)) {
            if (node) {
                nodes.push(node);
            }
        }
    }
    return nodes;
}

function normalizeEnabledValue(widgetValue, fallback = true) {
    if (typeof widgetValue === "boolean") {
        return widgetValue;
    }
    if (widgetValue && typeof widgetValue === "object" && "toggled" in widgetValue) {
        return Boolean(widgetValue.toggled);
    }
    return fallback;
}

function parseControlsJson(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function findWidget(node, name) {
    return node?.widgets?.find((widget) => widget?.name === name) || null;
}

function getGraphNodeById(node, nodeId) {
    if (node?.graph?.getNodeById) {
        return node.graph.getNodeById(nodeId);
    }
    return null;
}

function buildFastBypassRows(node) {
    const rows = [];
    const inputs = asArray(node?.inputs);
    const graph = node?.graph;
    for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        const linkId = input?.link;
        if (typeof linkId !== "number") continue;
        const link = graph?.links?.[linkId];
        if (!link || typeof link.origin_id !== "number") continue;
        const targetNode = getGraphNodeById(node, link.origin_id);
        if (!targetNode) continue;

        const widget = asArray(node?.widgets)[index] || null;
        const sourceTitle = safeString(node?.title || node?.type || "Fast Bypasser");
        const targetTitle = safeString(targetNode?.title || targetNode?.type || `Node ${targetNode.id}`);
        const rowLabel = targetTitle.replace(/^Enable\s+/i, "") || targetTitle;
        rows.push({
            id: `${node.id}:fast:${index}:${targetNode.id}`,
            source_node_id: safeString(node.id),
            source_title: sourceTitle,
            source_class_type: getNodeClassType(node),
            title: rowLabel,
            default_enabled: normalizeEnabledValue(widget?.value, targetNode?.mode !== 4),
            target_node_ids: [safeString(targetNode.id)],
        });
    }
    return rows;
}

function getGroupNodes(group) {
    const children = group?._children;
    if (!children || typeof children.values !== "function") {
        return [];
    }
    const nodes = [];
    for (const child of children.values()) {
        if (child && typeof child.id !== "undefined" && typeof child.type === "string") {
            nodes.push(child);
        }
    }
    return nodes;
}

function buildGroupRowId(node, group, fallbackIndex) {
    const graphId = safeString(group?.graph?.id ?? "root");
    const title = safeString(group?.title ?? `Group ${fallbackIndex + 1}`);
    const pos = asArray(group?._pos).join(",");
    const size = asArray(group?._size).join(",");
    return `${node.id}:group:${graphId}:${title}:${pos}:${size}`;
}

function buildFastGroupsRows(node) {
    const rows = [];
    const widgets = asArray(node?.widgets);
    let rowIndex = 0;
    for (const widget of widgets) {
        const group = widget?.group;
        if (!group) continue;
        group.recomputeInsideNodes?.();
        const targetNodeIds = getGroupNodes(group)
            .map((groupNode) => safeString(groupNode.id))
            .filter((id) => id && id !== safeString(node.id));
        if (targetNodeIds.length === 0) continue;

        rows.push({
            id: buildGroupRowId(node, group, rowIndex),
            source_node_id: safeString(node.id),
            source_title: safeString(node?.title || node?.type || "Fast Groups"),
            source_class_type: getNodeClassType(node),
            title: safeString(group?.title || `Group ${rowIndex + 1}`),
            default_enabled: normalizeEnabledValue(widget?.value, true),
            target_node_ids: targetNodeIds,
        });
        rowIndex += 1;
    }
    return rows;
}

function collectBypassRows() {
    const rows = [];
    for (const node of getAllNodes()) {
        const classType = getNodeClassType(node);
        if (FAST_BYPASSER_TYPES.has(classType)) {
            rows.push(...buildFastBypassRows(node));
        } else if (FAST_GROUPS_TYPES.has(classType)) {
            rows.push(...buildFastGroupsRows(node));
        }
    }
    const deduped = [];
    const seen = new Set();
    for (const row of rows) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        deduped.push(row);
    }
    deduped.sort((a, b) => {
        const bySource = safeString(a.source_title).localeCompare(safeString(b.source_title), undefined, { sensitivity: "base" });
        if (bySource !== 0) return bySource;
        const byTitle = safeString(a.title).localeCompare(safeString(b.title), undefined, { sensitivity: "base" });
        if (byTitle !== 0) return byTitle;
        return safeString(a.id).localeCompare(safeString(b.id), undefined, { sensitivity: "base" });
    });
    return deduped;
}

function mergeRows(existingRows, discoveredRows) {
    const discoveredById = new Map(discoveredRows.map((row) => [row.id, row]));
    const merged = [];

    for (const existing of existingRows) {
        const next = discoveredById.get(existing?.id);
        if (!next) continue;
        merged.push(next);
        discoveredById.delete(existing.id);
    }
    merged.push(...discoveredById.values());
    return merged.map((row, index) => ({ ...row, order: index }));
}

function writeRows(node, rows) {
    const serialized = JSON.stringify(rows);
    const controlsWidget = findWidget(node, "controls_json");
    if (controlsWidget) {
        controlsWidget.value = serialized;
        controlsWidget.hidden = true;
        controlsWidget.computeSize = () => [0, -4];
    }
    node.properties = node.properties || {};
    node.properties.controls_json = serialized;
    node.setDirtyCanvas?.(true, true);
}

function readRows(node) {
    const controlsWidget = findWidget(node, "controls_json");
    const raw = controlsWidget?.value ?? node?.properties?.controls_json ?? "[]";
    return parseControlsJson(raw);
}

function renderRows(node) {
    const state = node.__cozyBypassState;
    if (!state?.rowsEl) return;
    state.rowsEl.innerHTML = "";

    if (!state.rows.length) {
        const empty = document.createElement("div");
        empty.style.fontSize = "12px";
        empty.style.color = "#9ca3af";
        empty.textContent = "No supported rgthree bypass controls found.";
        state.rowsEl.appendChild(empty);
        return;
    }

    state.rows.forEach((row, index) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.gap = "8px";
        item.style.padding = "6px 8px";
        item.style.marginBottom = "6px";
        item.style.border = "1px solid #334155";
        item.style.borderRadius = "6px";
        item.style.background = "#111827";

        const text = document.createElement("div");
        text.style.display = "flex";
        text.style.flexDirection = "column";
        text.style.minWidth = "0";

        const label = document.createElement("div");
        label.style.fontSize = "12px";
        label.style.fontWeight = "600";
        label.style.color = "#e5e7eb";
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";
        label.style.whiteSpace = "nowrap";
        label.textContent = `${index + 1}. ${row.title}`;
        text.appendChild(label);

        const meta = document.createElement("div");
        meta.style.fontSize = "11px";
        meta.style.color = "#94a3b8";
        meta.style.overflow = "hidden";
        meta.style.textOverflow = "ellipsis";
        meta.style.whiteSpace = "nowrap";
        meta.textContent = `${row.source_title} | ${row.target_node_ids.length} target node(s)`;
        text.appendChild(meta);

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "4px";
        actions.style.flexShrink = "0";

        const up = document.createElement("button");
        up.textContent = "Up";
        up.disabled = index === 0;
        up.style.padding = "2px 6px";
        up.style.fontSize = "11px";
        up.onclick = () => {
            if (index <= 0) return;
            const moved = [...state.rows];
            const [itemRow] = moved.splice(index, 1);
            moved.splice(index - 1, 0, itemRow);
            state.rows = moved.map((entry, entryIndex) => ({ ...entry, order: entryIndex }));
            writeRows(node, state.rows);
            renderRows(node);
        };
        actions.appendChild(up);

        const down = document.createElement("button");
        down.textContent = "Down";
        down.disabled = index === state.rows.length - 1;
        down.style.padding = "2px 6px";
        down.style.fontSize = "11px";
        down.onclick = () => {
            if (index >= state.rows.length - 1) return;
            const moved = [...state.rows];
            const [itemRow] = moved.splice(index, 1);
            moved.splice(index + 1, 0, itemRow);
            state.rows = moved.map((entry, entryIndex) => ({ ...entry, order: entryIndex }));
            writeRows(node, state.rows);
            renderRows(node);
        };
        actions.appendChild(down);

        item.appendChild(text);
        item.appendChild(actions);
        state.rowsEl.appendChild(item);
    });
}

function refreshNodeRows(node) {
    const discovered = collectBypassRows();
    const existing = readRows(node);
    const merged = mergeRows(existing, discovered);
    node.__cozyBypassState.rows = merged;
    node.__cozyBypassState.summaryEl.textContent = `${merged.length} bypass control row(s)`;
    writeRows(node, merged);
    renderRows(node);
}

function ensureNodeUI(node) {
    if (node.__cozyBypassState) {
        return node.__cozyBypassState;
    }
    const state = {
        rows: [],
        summaryEl: null,
        rowsEl: null,
    };

    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.padding = "8px";
    container.style.background = "#0f172a";
    container.style.border = "1px solid #1f2937";
    container.style.borderRadius = "8px";

    const title = document.createElement("div");
    title.style.fontSize = "13px";
    title.style.fontWeight = "700";
    title.style.color = "#e5e7eb";
    title.textContent = "RGThree Bypass Controls";
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
    refreshBtn.style.padding = "4px 8px";
    refreshBtn.style.fontSize = "12px";
    refreshBtn.style.cursor = "pointer";
    refreshBtn.onclick = () => refreshNodeRows(node);
    controls.appendChild(refreshBtn);
    container.appendChild(controls);

    const rowsEl = document.createElement("div");
    rowsEl.style.display = "block";
    rowsEl.style.maxHeight = "260px";
    rowsEl.style.overflowY = "auto";
    rowsEl.style.paddingRight = "2px";
    container.appendChild(rowsEl);
    state.rowsEl = rowsEl;

    const domWidget = node.addDOMWidget("cozy_bypass_controls_ui", "div", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 220,
    });
    domWidget.computeSize = function (width) {
        return [width, Math.max(220, Number(node.size?.[1] || 220) - 90)];
    };

    if (!node.size || node.size[0] < 520 || node.size[1] < 420) {
        node.size = [520, 420];
    }

    node.__cozyBypassState = state;
    return state;
}

function refreshAllBypassControlNodes() {
    for (const node of getAllNodes()) {
        if (getNodeClassType(node) !== NODE_TYPE) continue;
        ensureNodeUI(node);
        refreshNodeRows(node);
    }
}

if (!app.__cozyBypassControlsPatched) {
    const originalGraphToPrompt = app.graphToPrompt;
    app.graphToPrompt = async function () {
        refreshAllBypassControlNodes();
        return originalGraphToPrompt.apply(this, arguments);
    };
    app.__cozyBypassControlsPatched = true;
}

app.registerExtension({
    name: "cozygen.bypass_controls",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            ensureNodeUI(this);
            refreshNodeRows(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            ensureNodeUI(this);
            refreshNodeRows(this);
        };

        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            if (Array.isArray(options)) {
                options.unshift({
                    content: "Refresh RGThree Controls",
                    callback: () => refreshNodeRows(this),
                });
            }
            getExtraMenuOptions?.apply(this, arguments);
        };
    },
});
