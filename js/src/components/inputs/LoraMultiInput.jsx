import React from 'react';
import LoraInput from './LoraInput';

const LoraMultiInput = ({ value, onChange, choices }) => {
  const MAX_LORAS = 5;
  const EMPTY_LORA = { lora: 'None', strength: 0 };
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

  const emitValues = (nextValues, nextCount = activeCount) => {
    const normalized = Array.from({ length: MAX_LORAS }, (_, index) => ({
      lora: nextValues[index]?.lora ?? EMPTY_LORA.lora,
      strength: nextValues[index]?.strength ?? (index < nextCount ? 1.0 : EMPTY_LORA.strength),
    }));
    for (let index = nextCount; index < MAX_LORAS; index += 1) {
      normalized[index] = { ...EMPTY_LORA };
    }
    normalized.num_loras = Math.max(1, Math.min(MAX_LORAS, nextCount));
    onChange(normalized);
  };

  const handleChange = (index, nextValue) => {
    const nextValues = [...loraDefaults];
    nextValues[index] = nextValue;
    emitValues(nextValues, activeCount);
  };

  const handleCountChange = (nextCountValue) => {
    const nextCount = normalizeCount(nextCountValue);
    const nextValues = [...loraDefaults];
    emitValues(nextValues, nextCount);
  };

  const handleCountStep = (delta) => {
    handleCountChange(activeCount + delta);
  };

  const handleRemove = (removeIndex) => {
    const visible = loraDefaults.slice(0, activeCount);
    const compacted = visible.filter((_, index) => index !== removeIndex);
    if (compacted.length === 0) {
      emitValues([{ ...EMPTY_LORA }], 1);
      return;
    }
    emitValues(compacted, compacted.length);
  };

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-sm text-gray-300">Active LoRAs</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-sm w-10"
            onClick={() => handleCountStep(-1)}
            disabled={activeCount <= 1}
            aria-label="Decrease active LoRAs"
            title="Decrease active LoRAs"
          >
            -
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LORAS}
            step={1}
            value={activeCount}
            onChange={(event) => handleCountChange(event.target.value)}
            className="input input-bordered w-20 text-center text-base sm:text-sm"
            aria-label="Active LoRAs"
          />
          <button
            type="button"
            className="btn btn-sm w-10"
            onClick={() => handleCountStep(1)}
            disabled={activeCount >= MAX_LORAS}
            aria-label="Increase active LoRAs"
            title="Increase active LoRAs"
          >
            +
          </button>
        </div>
      </div>
      {loraDefaults.slice(0, activeCount).map((loraValue, index) => (
        <div key={`lora-${index}`} className="w-full flex items-start gap-2">
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-square shrink-0 text-red-300 hover:text-red-200"
            onClick={() => handleRemove(index)}
            aria-label={`Remove LoRA ${index + 1}`}
            title={`Remove LoRA ${index + 1}`}
          >
            X
          </button>
          <div className="min-w-0 flex-1">
            <LoraInput
              value={loraValue}
              onChange={(val) => handleChange(index, val)}
              choices={choices}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-gray-400">
        Outputs one LORA_STACK value for downstream stack-aware nodes.
      </p>
    </div>
  );
};

export default LoraMultiInput;
