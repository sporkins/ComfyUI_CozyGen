import React from 'react';

const DEFAULT_MAX_SEED = 1125899906842624;

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const randomIntInRange = (minValue, maxValue) => {
  const min = Math.floor(minValue);
  const max = Math.floor(maxValue);
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const SeedInput = ({ value, onChange, min, max, disabled }) => {
  const minValue = Number.isFinite(Number(min)) ? Number(min) : 0;
  const maxValue = Number.isFinite(Number(max)) ? Number(max) : DEFAULT_MAX_SEED;

  const handleValueChange = (e) => {
    const nextValue = e.target.value;
    if (nextValue === '') {
      onChange('');
      return;
    }
    onChange(toInt(nextValue, minValue));
  };

  const handleRandomize = () => {
    onChange(randomIntInRange(minValue, maxValue));
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="block w-full p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all disabled:bg-base-300/50 disabled:cursor-not-allowed disabled:text-gray-400"
          value={value ?? ''}
          onChange={handleValueChange}
          min={minValue}
          max={maxValue}
          step={1}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-sm btn-outline border-base-300 hover:border-accent disabled:opacity-50"
          onClick={handleRandomize}
          disabled={disabled}
          title="Randomize seed"
        >
          Randomize
        </button>
      </div>
    </div>
  );
};

export default SeedInput;
