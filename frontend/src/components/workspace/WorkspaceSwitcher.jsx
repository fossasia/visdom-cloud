/* Copyright 2017-present, The Visdom Authors */
import React, { useRef, useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import SelectWorkspaceModal from './SelectWorkspaceModal';

const WorkspaceSwitcher = ({ workspaces, activeWorkspace, isLoading = false, onSwitch, onCreated, onWorkspaceUpdated }) => {
  const [showSelect, setShowSelect] = useState(false);
  const triggerRef = useRef(null);

  const handleCloseSelect = () => {
    setShowSelect(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="gc-ws-switcher">
      <button
        ref={triggerRef}
        className="gc-ws-trigger"
        onClick={() => setShowSelect(true)}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={showSelect}
        aria-controls="visdom-select-workspace-modal"
      >
        <Building2 size={14} />
        <span className="gc-ws-trigger-label">
          {isLoading ? 'Loading workspaces...' : activeWorkspace ? activeWorkspace.name : 'Select workspace'}
        </span>
        <ChevronDown size={14} className="gc-ml-auto gc-shrink-0" />
      </button>

      {showSelect && (
        <SelectWorkspaceModal
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          isLoading={isLoading}
          onClose={handleCloseSelect}
          onSwitch={onSwitch}
          onCreated={onCreated}
          onWorkspaceUpdated={onWorkspaceUpdated}
        />
      )}
    </div>
  );
};

export default WorkspaceSwitcher;
