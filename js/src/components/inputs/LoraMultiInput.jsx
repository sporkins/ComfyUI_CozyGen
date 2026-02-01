import React from 'react';
import LoraInput from './LoraInput';

const LoraMultiInput = ({ value, onChange, choices }) => {
  const values = Array.isArray(value) ? value : [];
  const loraDefaults = Array.from({ length: 5 }, (_, index) => ({
    lora: values[index]?.lora ?? 'None',
    strength: values[index]?.strength ?? 1.0,
  }));

  const handleChange = (index, nextValue) => {
    const nextValues = [...loraDefaults];
    nextValues[index] = nextValue;
    onChange(nextValues);
  };

  return (
    <div className="w-full flex flex-col gap-2">
      {loraDefaults.map((loraValue, index) => (
        <div key={`lora-${index}`} className="w-full">
          <LoraInput
            value={loraValue}
            onChange={(val) => handleChange(index, val)}
            choices={choices}
          />
        </div>
      ))}
      <p className="text-xs text-gray-400">
        Outputs LoRA filenames and strengths only (no loading here).
      </p>
    </div>
  );
};

export default LoraMultiInput;
