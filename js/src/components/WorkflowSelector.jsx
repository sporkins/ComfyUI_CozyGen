import React from 'react';
import SearchableSelect from './SearchableSelect';

const WorkflowSelector = ({ workflows, selectedWorkflow, onSelect }) => {
  return (
    <div className="bg-base-200 shadow-lg rounded-lg p-3">
      <label htmlFor="workflow-selector" className="block text-lg font-semibold text-white mb-2">
        Workflow
      </label>
      <SearchableSelect
        id="workflow-selector"
        className="w-full"
        buttonClassName="block w-full p-3 border border-base-300 bg-base-100 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all"
        value={selectedWorkflow || ''}
        onChange={onSelect}
        options={workflows}
        placeholder="-- Select a workflow --"
      />
    </div>
  );
};

export default WorkflowSelector;
