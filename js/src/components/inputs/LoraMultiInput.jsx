import React from 'react';
import LoraInput from './LoraInput';

const LoraMultiInput = ({ value, onChange, choices }) => {
  const MAX_LORAS = 5;
  const values = Array.isArray(value) ? value : [];
  const normalizeCount = (count) => Math.max(1, Math.min(MAX_LORAS, Number.parseInt(count, 10) || MAX_LORAS));
  const inferCount = () => {
    let highest = 0;
    for (let index = 0; index < MAX_LORAS; index += 1) {
      const lora = values[index]?.lora ?? 'None';
      const strength = Number(values[index]?.strength ?? 0);
      if (lora !== 'None' && strength !== 0) {
        highest = index + 1;
      }
    }
    return highest > 0 ? highest : MAX_LORAS;
  };

  const activeCount = normalizeCount(values.num_loras ?? inferCount());
  const loraDefaults = Array.from({ length: MAX_LORAS }, (_, index) => ({
    lora: values[index]?.lora ?? 'None',
    strength: values[index]?.strength ?? 1.0,
  }));

  const handleChange = (index, nextValue) => {
    const nextValues = [...loraDefaults];
    nextValues[index] = nextValue;
    nextValues.num_loras = activeCount;
    onChange(nextValues);
  };

  const handleCountChange = (nextCountValue) => {
    const nextCount = normalizeCount(nextCountValue);
    const nextValues = [...loraDefaults];
    for (let index = nextCount; index < MAX_LORAS; index += 1) {
      nextValues[index] = { lora: 'None', strength: 0 };
    }
    nextValues.num_loras = nextCount;
    onChange(nextValues);
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-300">Active LoRAs</span>
        <input
          type="number"
          min={1}
          max={MAX_LORAS}
          step={1}
          value={activeCount}
          onChange={(event) => handleCountChange(event.target.value)}
          className="input input-bordered input-sm w-24"
        />
      </div>
      {loraDefaults.slice(0, activeCount).map((loraValue, index) => (
        <div key={`lora-${index}`} className="w-full">
          <LoraInput
            value={loraValue}
            onChange={(val) => handleChange(index, val)}
            choices={choices}
          />
        </div>
      ))}
      <p className="text-xs text-gray-400">
        Outputs one LORA_STACK value for downstream stack-aware nodes.
      </p>
    </div>
  );
};

export default LoraMultiInput;
