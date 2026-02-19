import { app } from "../../scripts/app.js";

function normalizeChoiceValue(value) {
    if (value == null) return "";
    return String(value).trim().replace(/\\/g, "/");
}

// Helper function to get choices from the backend API
async function getChoices(choiceType) {
    try {
        const response = await fetch(`/cozygen/get_choices?type=${choiceType}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch choices: ${response.statusText}`);
        }
        const data = await response.json();
        return data.choices || [];
    } catch (error) {
        console.error(`CozyGenChoiceInput: Error fetching choices for type '${choiceType}':`, error);
        return [];
    }
}

function normalizeChoices(rawChoices) {
    if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
        return ["None"];
    }
    return rawChoices.map((choice) => String(choice));
}

function ensureComboWidget(node, widgetName, choices, fallbackValue) {
    const widget = node.widgets?.find((w) => w.name === widgetName);
    if (!widget) return null;
    node.properties = node.properties || {};

    const normalizedLookup = new Map();
    for (const choice of choices) {
        normalizedLookup.set(normalizeChoiceValue(choice), choice);
    }

    const currentValue = normalizedLookup.get(normalizeChoiceValue(widget.value));
    const fallback = normalizedLookup.get(normalizeChoiceValue(fallbackValue));
    const nextValue = currentValue ?? fallback ?? choices[0];

    const callback = typeof widget.callback === "function" ? widget.callback : null;
    const comboWidget = {
        type: "combo",
        name: widgetName,
        value: nextValue,
        options: { values: choices },
    };
    comboWidget.callback = (value) => {
        comboWidget.value = value;
        node.properties[widgetName] = value;
        callback?.(value);
    };

    node.widgets.splice(node.widgets.indexOf(widget), 1, comboWidget);
    node.properties[widgetName] = nextValue;
    return comboWidget;
}

async function refreshChoiceWidgets(node) {
    const choiceTypeWidget = node.widgets?.find((w) => w.name === "choice_type");
    if (!choiceTypeWidget) return;

    const rawChoices = await getChoices(choiceTypeWidget.value);
    const choices = normalizeChoices(rawChoices);

    const defaultChoiceWidget = ensureComboWidget(node, "default_choice", choices, choices[0]);
    const selectedDefault = defaultChoiceWidget?.value ?? choices[0];
    ensureComboWidget(node, "value", choices, selectedDefault);

    node.setDirtyCanvas(true, true);
}

function patchChoiceTypeCallback(node) {
    const choiceTypeWidget = node.widgets?.find((w) => w.name === "choice_type");
    if (!choiceTypeWidget || choiceTypeWidget.__cozygenChoicePatched) return;

    const originalCallback = choiceTypeWidget.callback;
    choiceTypeWidget.callback = (value) => {
        originalCallback?.(value);
        void refreshChoiceWidgets(node);
    };
    choiceTypeWidget.__cozygenChoicePatched = true;
}

app.registerExtension({
	name: "CozyGen.ChoiceInput",
	async beforeRegisterNodeDef(nodeType, nodeData, app) {
		if (nodeData.name === "CozyGenChoiceInput") {
			const onNodeCreated = nodeType.prototype.onNodeCreated;
			nodeType.prototype.onNodeCreated = async function () {
				onNodeCreated?.apply(this, arguments);
                patchChoiceTypeCallback(this);
                await refreshChoiceWidgets(this);
			};

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = async function () {
                onConfigure?.apply(this, arguments);
                patchChoiceTypeCallback(this);
                await refreshChoiceWidgets(this);
            };
		}
	},
});
