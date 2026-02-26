import React from 'react';
import SearchableSelect from '../SearchableSelect';

const SelectField = ({ label, value, onChange, choices }) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs text-gray-400">{label}</span>
    <SearchableSelect
      className="w-full"
      buttonClassName="block w-full p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all disabled:bg-base-300/50 disabled:cursor-not-allowed disabled:text-gray-400"
      value={value}
      onChange={onChange}
      options={choices}
    />
  </div>
);

const ToggleField = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-3 rounded-md border border-base-300 bg-base-100 px-3 py-2">
    <span className="text-sm text-gray-300">{label}</span>
    <input
      type="checkbox"
      className="toggle toggle-sm toggle-accent"
      checked={Boolean(checked)}
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>
);

const GGUFLoaderKJModelInput = ({ value, onChange, choices }) => {
  const safeValue = value || {};
  const {
    model_name: modelName,
    extra_model_name: extraModelName,
    dequant_dtype: dequantDtype,
    patch_dtype: patchDtype,
    patch_on_device: patchOnDevice,
    enable_fp16_accumulation: enableFp16Accumulation,
    attention_override: attentionOverride,
  } = safeValue;

  const modelChoices = choices?.modelNames || [];
  const extraModelChoices = choices?.extraModelNames || [];
  const dequantDtypeChoices = choices?.dequantDtypes || [];
  const patchDtypeChoices = choices?.patchDtypes || [];
  const attentionOverrideChoices = choices?.attentionOverrides || [];

  return (
    <div className="w-full flex flex-col gap-3">
      <SelectField
        label="Model"
        value={modelName || modelChoices[0] || 'none'}
        onChange={(nextModel) => onChange({ ...safeValue, model_name: nextModel })}
        choices={modelChoices}
      />
      <SelectField
        label="Extra model"
        value={extraModelName || extraModelChoices[0] || 'none'}
        onChange={(nextExtraModel) => onChange({ ...safeValue, extra_model_name: nextExtraModel })}
        choices={extraModelChoices}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SelectField
          label="Dequant dtype"
          value={dequantDtype || dequantDtypeChoices[0] || 'default'}
          onChange={(nextValue) => onChange({ ...safeValue, dequant_dtype: nextValue })}
          choices={dequantDtypeChoices}
        />
        <SelectField
          label="Patch dtype"
          value={patchDtype || patchDtypeChoices[0] || 'default'}
          onChange={(nextValue) => onChange({ ...safeValue, patch_dtype: nextValue })}
          choices={patchDtypeChoices}
        />
        <SelectField
          label="Attention override"
          value={attentionOverride || attentionOverrideChoices[0] || 'none'}
          onChange={(nextValue) => onChange({ ...safeValue, attention_override: nextValue })}
          choices={attentionOverrideChoices}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ToggleField
          label="Patch on device"
          checked={patchOnDevice}
          onChange={(nextValue) => onChange({ ...safeValue, patch_on_device: nextValue })}
        />
        <ToggleField
          label="Enable FP16 accumulation"
          checked={enableFp16Accumulation}
          onChange={(nextValue) => onChange({ ...safeValue, enable_fp16_accumulation: nextValue })}
        />
      </div>
      <p className="text-xs text-gray-400">
        Outputs GGUFLoaderKJ settings only (no model loading here).
      </p>
    </div>
  );
};

export default GGUFLoaderKJModelInput;
