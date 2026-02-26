import React from 'react';
import StringInput from './inputs/StringInput';
import NumberInput from './inputs/NumberInput';
import BooleanInput from './inputs/BooleanInput';
import DropdownInput from './inputs/DropdownInput';
import LoraInput from './inputs/LoraInput';
import LoraMultiInput from './inputs/LoraMultiInput';
import WanVideoModelInput from './inputs/WanVideoModelInput';
import GGUFLoaderKJModelInput from './inputs/GGUFLoaderKJModelInput';
import SeedInput from './inputs/SeedInput';

const getInputCollapseKey = (input) => String(input?.id ?? input?.inputs?.param_name ?? '');

const renderInput = (
    input,
    formData,
    onFormChange,
    randomizeState,
    onRandomizeToggle,
    bypassedState,
    onBypassToggle,
    collapsedInputs,
    onToggleCollapse
) => {
    
    const { id, inputs } = input;
    const param_name = inputs['param_name'];
    const param_type = inputs['param_type'];
    const defaultValue = inputs['default_value'];
    const value = formData[param_name] !== undefined ? formData[param_name] : defaultValue;
    const displayBypass = inputs['display_bypass']; // Get the display_bypass property
    const isBypassed = bypassedState[param_name] || false; // Get current bypass state
    const collapseKey = getInputCollapseKey(input);
    const isCollapsed = Boolean(collapsedInputs?.[collapseKey]);

    let inputComponent;

    switch (param_type) {
        case 'STRING':
            inputComponent = <StringInput 
                        value={value} 
                        onChange={(val) => onFormChange(param_name, val)} 
                        multiline={inputs['Multiline']}
                        disabled={isBypassed}
                    />;
            break;
        case 'INT':
        case 'FLOAT':
            inputComponent = <NumberInput
                        inputName={param_name}
                        value={value}
                        onChange={(val) => onFormChange(param_name, val)}
                        onRandomizeToggle={inputs['add_randomize_toggle'] ? (isRandom) => onRandomizeToggle(param_name, isRandom) : null}
                        isRandomized={randomizeState[param_name] || false}
                        min={inputs['min_value']}
                        max={inputs['max_value']}
                        step={inputs['step']}
                        paramType={param_type}
                        disabled={isBypassed}
                    />;
            break;
        case 'SEED':
            inputComponent = <SeedInput
                        value={value}
                        onChange={(val) => onFormChange(param_name, val)}
                        min={inputs['min_value']}
                        max={inputs['max_value']}
                        disabled={isBypassed}
                    />;
            break;
        case 'BOOLEAN':
            inputComponent = <BooleanInput
                        value={value}
                        onChange={(val) => onFormChange(param_name, val)}
                        disabled={isBypassed}
                    />;
            break;
        case 'BOOL':
            inputComponent = <BooleanInput
                        value={value}
                        onChange={(val) => onFormChange(param_name, val)}
                        disabled={false}
                    />;
            break;
        case 'DROPDOWN':
            inputComponent = <DropdownInput
                        value={value}
                        onChange={(val) => onFormChange(param_name, val)}
                        choices={inputs['choices']}
                        disabled={isBypassed}
                    />;
            break;
        case 'LORA':
            inputComponent = <LoraInput
                    value={value ?? { lora: inputs["lora_value"], strength: inputs["strength_value"] }}
                    onChange={(val) => onFormChange(param_name, val)}
                    choices={inputs['choices']}
                />;
            break;
        case 'LORA_MULTI':
            inputComponent = <LoraMultiInput
                    value={value ?? []}
                    onChange={(val) => onFormChange(param_name, val)}
                    choices={inputs['choices']}
                />;
            break;
        case 'WANVIDEO_MODEL':
            inputComponent = <WanVideoModelInput
                    value={value ?? {
                        model_name: inputs['model_name'],
                        base_precision: inputs['base_precision'],
                        quantization: inputs['quantization'],
                        load_device: inputs['load_device'],
                    }}
                    onChange={(val) => onFormChange(param_name, val)}
                    choices={inputs['choices']}
                />;
            break;
        case 'GGUFLOADERKJ_MODEL':
            inputComponent = <GGUFLoaderKJModelInput
                    value={value ?? {
                        model_name: inputs['model_name'],
                        extra_model_name: inputs['extra_model_name'],
                        dequant_dtype: inputs['dequant_dtype'],
                        patch_dtype: inputs['patch_dtype'],
                        patch_on_device: inputs['patch_on_device'],
                        enable_fp16_accumulation: inputs['enable_fp16_accumulation'],
                        attention_override: inputs['attention_override'],
                    }}
                    onChange={(val) => onFormChange(param_name, val)}
                    choices={inputs['choices']}
                />;
            break;
        default:
            inputComponent = <p>Unsupported input type: {param_type}</p>;
    }

    return (
        <div className="flex flex-col rounded-lg border border-base-300/70 bg-base-300/20 p-3">
            <div className={`flex justify-between items-start gap-2 ${isCollapsed ? '' : 'mb-2'}`}>
                <label className="block text-sm font-medium text-gray-300 flex-1 min-w-0">
                    {param_name}
                    {inputs['add_randomize_toggle'] && (
                        <span className="ml-2 text-xs text-gray-400">
                            (Randomize
                            <input
                                type="checkbox"
                                className="toggle toggle-sm toggle-accent ml-1"
                                checked={randomizeState[param_name] || false}
                                onChange={(e) => onRandomizeToggle(param_name, e.target.checked)}
                            />)
                        </span>
                    )}
                    {displayBypass && (
                        <span className="ml-2 text-xs text-gray-400">
                            (Bypass
                            <input
                                type="checkbox"
                                className="toggle toggle-sm toggle-accent ml-1"
                                checked={isBypassed}
                                onChange={(e) => onBypassToggle(param_name, e.target.checked)}
                            />)
                        </span>
                    )}
                </label>
                <button
                    type="button"
                    className="btn btn-ghost btn-xs shrink-0"
                    aria-expanded={!isCollapsed}
                    onClick={() => onToggleCollapse?.(collapseKey)}
                >
                    {isCollapsed ? 'Expand' : 'Collapse'}
                </button>
            </div>
            {!isCollapsed && inputComponent}
        </div>
    );
};

const DynamicForm = ({
  inputs,
  formData,
  onFormChange,
  randomizeState,
  onRandomizeToggle,
  bypassedState,
  onBypassToggle,
  collapsedInputs,
  onToggleCollapse,
}) => {
  if (!inputs || inputs.length === 0) {
    return (
        <div className="bg-base-200 shadow-lg rounded-lg p-3 text-center">
            <p className="text-gray-400">Select a workflow to see its controls.</p>
        </div>
    );
  }

  return (
    <div className="bg-base-200 shadow-lg rounded-lg p-3">
      <h2 className="text-lg font-semibold text-white mb-2">Controls</h2>
      <div className="grid grid-cols-1 xs:grid-cols-2 gap-x-4 gap-y-4">
        {inputs.map(input => (
            <div key={input.id} className={(input.inputs['Multiline'] || ['LORA', 'LORA_MULTI', 'WANVIDEO_MODEL', 'GGUFLOADERKJ_MODEL'].includes(input.inputs.param_type)) ? 'xs:col-span-2' : ''}>
                {renderInput(input, formData, onFormChange, randomizeState, onRandomizeToggle, bypassedState, onBypassToggle, collapsedInputs, onToggleCollapse)}
            </div>
        ))}
      </div>
    </div>
  );
};

export default DynamicForm;
