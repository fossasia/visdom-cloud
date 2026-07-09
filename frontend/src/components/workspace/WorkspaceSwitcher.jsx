/* Copyright 2017-present, The Visdom Authors */
import React, { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, Plus } from 'lucide-react';
import CreateWorkspaceModal from './CreateWorkspaceModal';

const WorkspaceSwitcher = ({ workspaces, activeWorkspace, onSwitch, onCreated }) => {
  const [open, setOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitch = (workspace) => {
    onSwitch(workspace);
    setOpen(false);
  };

  const handleCreated = (workspace) => {
    setShowCreateModal(false);
    setOpen(false);
    onCreated(workspace);
  };

  return (
    <div className="gc-ws-switcher" ref={containerRef}>
      <button className="gc-ws-trigger" onClick={() => setOpen((v) => !v)} type="button">
        <Building2 size={14} />
        <span className="gc-ws-trigger-label">
          {activeWorkspace ? activeWorkspace.name : 'No workspace'}
        </span>
        <ChevronDown size={14} style={{ marginLeft: 'auto', flexShrink: 0 }} />
      </button>

      {open && (
        <div className="gc-ws-dropdown">
          {workspaces.length === 0 ? (
            <div style={{ padding: '10px', fontSize: '12px', color: 'var(--vc-text-muted)' }}>
              You don't belong to any workspaces yet.
            </div>
          ) : (
            workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                className={`gc-ws-item ${activeWorkspace?.id === ws.id ? 'active' : ''}`}
                onClick={() => handleSwitch(ws)}
              >
                <span>
                  <div className="gc-ws-item-name">{ws.name}</div>
                  <div className="gc-ws-item-slug">{ws.slug}</div>
                </span>
              </button>
            ))
          )}

          <div className="gc-ws-divider" />

          <button type="button" className="gc-ws-add-btn" onClick={() => setShowCreateModal(true)}>
            <Plus size={14} />
            Add Workspace
          </button>
        </div>
      )}

      {showCreateModal && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
};

export default WorkspaceSwitcher;
