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

const WanVideoModelInput = ({ value, onChange, choices }) => {
  const safeValue = value || {};
  const {
    model_name: modelName,
    base_precision: basePrecision,
    quantization,
    load_device: loadDevice,
  } = safeValue;
  const modelChoices = choices?.modelNames || [];
  const basePrecisionChoices = choices?.basePrecisions || [];
  const quantizationChoices = choices?.quantizations || [];
  const loadDeviceChoices = choices?.loadDevices || [];

  return (
    <div className="w-full flex flex-col gap-3">
      <SelectField
        label="Model"
        value={modelName || modelChoices[0] || 'none'}
        onChange={(nextModel) => onChange({ ...safeValue, model_name: nextModel })}
        choices={modelChoices}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SelectField
          label="Base precision"
          value={basePrecision || basePrecisionChoices[0] || 'bf16'}
          onChange={(nextPrecision) => onChange({ ...safeValue, base_precision: nextPrecision })}
          choices={basePrecisionChoices}
        />
        <SelectField
          label="Quantization"
          value={quantization || quantizationChoices[0] || 'disabled'}
          onChange={(nextQuant) => onChange({ ...safeValue, quantization: nextQuant })}
          choices={quantizationChoices}
        />
        <SelectField
          label="Load device"
          value={loadDevice || loadDeviceChoices[0] || 'offload_device'}
          onChange={(nextDevice) => onChange({ ...safeValue, load_device: nextDevice })}
          choices={loadDeviceChoices}
        />
      </div>
      <p className="text-xs text-gray-400">
        Outputs model settings only (no model loading here).
      </p>
    </div>
  );
};

export default WanVideoModelInput;
