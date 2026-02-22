import React from 'react';
import SearchableSelect from '../SearchableSelect';

const LoraInput = ({ value, onChange, choices }) => {
  return (
    <div className="w-full flex flex-row items-start gap-2">
      <SearchableSelect
        className="min-w-0 flex-1"
        buttonClassName="w-full block p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all disabled:bg-base-300/50 disabled:cursor-not-allowed disabled:text-gray-400"
        value={value.lora || 'None'}
        onChange={(nextValue) => onChange({ ...value, lora: nextValue })}
        options={choices}
      />
      <input
        type="number"
        className="block w-20 sm:w-24 shrink-0 p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all disabled:bg-base-300/50 disabled:cursor-not-allowed disabled:text-gray-400"
        value={value.strength || 0}
        onChange={(e) => onChange({ ...value, strength: parseFloat(e.target.value) })}
        min={-5}
        max={5}
        step={0.01}
        title="LoRA strength"
      />
    </div>
  );
};

export default LoraInput;
