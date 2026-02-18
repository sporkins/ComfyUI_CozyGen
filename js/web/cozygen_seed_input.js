import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MAX_SEED_NUM = 1125899906842624;
const SEED_WIDGET_NAMES = new Set(["seed", "seed_num", "noise_seed"]);
const COZY_SEED_NODE_NAME = "CozyGenSeedInput";

function randomIntInRange(minValue, maxValue) {
    const min = Number.isFinite(minValue) ? Math.floor(minValue) : 0;
    const max = Number.isFinite(maxValue) ? Math.floor(maxValue) : MAX_SEED_NUM;
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function findSeedWidget(node) {
    if (!node?.widgets) return null;
    return node.widgets.find((widget) => widget.name === "seed");
}

if (!api.cozySeedQueuePatched) {
    const originalQueuePrompt = api.queuePrompt;
    api.queuePrompt = async function queuePromptWithSeedWidgets(number, { output, workflow }) {
        if (workflow && typeof workflow === "object") {
            workflow.seed_widgets = {};
            for (const [nodeId, node] of Object.entries(app.graph?._nodes_by_id || {})) {
                if (!node?.widgets) continue;
                const seedWidgetIndex = node.widgets.findIndex(
                    (widget) => SEED_WIDGET_NAMES.has(widget.name) && widget.type !== "converted-widget"
                );
                if (seedWidgetIndex !== -1) {
                    workflow.seed_widgets[nodeId] = seedWidgetIndex;
                }
            }
        }

        return originalQueuePrompt.call(api, number, { output, workflow });
    };

    api.cozySeedQueuePatched = true;
}

app.registerExtension({
    name: "cozygen.seed_input",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== COZY_SEED_NODE_NAME) return;

        function ensureRandomizeButton(node) {
            const seedWidget = findSeedWidget(node);
            if (!seedWidget) return;

            const hasButton = node.widgets?.some((widget) => widget.name === "randomize_seed");
            if (!hasButton) {
                node.addWidget("button", "randomize_seed", "Randomize", () => {
                    const minValue = Number(seedWidget.options?.min ?? 0);
                    const maxValue = Number(seedWidget.options?.max ?? MAX_SEED_NUM);
                    seedWidget.value = randomIntInRange(minValue, maxValue);
                    node.setDirtyCanvas(true, true);
                }, { serialize: false });
            }
        }

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            ensureRandomizeButton(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            ensureRandomizeButton(this);
        };

        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            if (!Array.isArray(options)) {
                return getExtraMenuOptions?.apply(this, arguments);
            }
            const seedWidget = findSeedWidget(this);
            if (seedWidget) {
                options.unshift({
                    content: "Randomize Seed",
                    callback: () => {
                        const minValue = Number(seedWidget.options?.min ?? 0);
                        const maxValue = Number(seedWidget.options?.max ?? MAX_SEED_NUM);
                        seedWidget.value = randomIntInRange(minValue, maxValue);
                        this.setDirtyCanvas(true, true);
                    },
                });
            }
            getExtraMenuOptions?.apply(this, arguments);
        };
    },
});
