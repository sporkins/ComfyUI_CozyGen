import React, { useCallback, useEffect, useRef } from 'react';

const StringInput = ({ value, onChange, multiline, disabled }) => {
  const disabledClasses = "disabled:bg-base-300/50 disabled:cursor-not-allowed disabled:text-gray-400";
  const textareaRef = useRef(null);
  const resizeTextarea = useCallback((element) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (!multiline) return;
    resizeTextarea(textareaRef.current);
  }, [multiline, value, resizeTextarea]);

  if (multiline) {
    return (
      <textarea
        ref={textareaRef}
        rows={4}
        className={`block w-full p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all min-h-24 resize-none overflow-hidden ${disabledClasses}`}
        value={value || ''}
        onChange={(e) => {
          resizeTextarea(e.target);
          onChange(e.target.value);
        }}
        disabled={disabled}
      />
    );
  }

  return (
    <input
      type="text"
      className={`block w-full p-2.5 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all ${disabledClasses}`}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
};

export default StringInput;
