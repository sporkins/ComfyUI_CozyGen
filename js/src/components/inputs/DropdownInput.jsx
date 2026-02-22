import React from 'react';
import SearchableSelect from '../SearchableSelect';

const DropdownInput = ({ value, onChange, choices, disabled }) => {
  return (
    <div className="w-full">
      <SearchableSelect
        className="w-full"
        buttonClassName="block w-full p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all disabled:bg-base-300/50 disabled:cursor-not-allowed disabled:text-gray-400"
        value={value || ''}
        onChange={onChange}
        disabled={disabled}
        options={choices}
      />
    </div>
  );
};

export default DropdownInput;
