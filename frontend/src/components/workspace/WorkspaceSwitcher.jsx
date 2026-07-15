/* Copyright 2017-present, The Visdom Authors */
import { useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import SelectWorkspaceModal from './SelectWorkspaceModal';

const WorkspaceSwitcher = ({ workspaces, activeWorkspace, onSwitch, onCreated, onWorkspaceUpdated }) => {
  const [showSelect, setShowSelect] = useState(false);

  return (
    <div className="gc-ws-switcher">
      <button className="gc-ws-trigger" onClick={() => setShowSelect(true)} type="button">
        <Building2 size={14} />
        <span className="gc-ws-trigger-label">
          {activeWorkspace ? activeWorkspace.name : 'Select workspace'}
        </span>
        <ChevronDown size={14} className="gc-ml-auto gc-shrink-0" />
      </button>

      {showSelect && (
        <SelectWorkspaceModal
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onClose={() => setShowSelect(false)}
          onSwitch={onSwitch}
          onCreated={onCreated}
          onWorkspaceUpdated={onWorkspaceUpdated}
        />
      )}
    </div>
  );
};

export default WorkspaceSwitcher;
