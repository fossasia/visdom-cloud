/* Copyright 2017-present, The Visdom Authors */
import React, { useMemo, useState } from 'react';
import { Building2, Check, Plus, Search, Star, X } from 'lucide-react';
import { api } from '../../context/AuthContext';
import ModalPortal from '../ModalPortal';
import CreateWorkspaceModal from './CreateWorkspaceModal';

const RECENT_KEY = 'visdom-recent-workspaces';
const MAX_RECENT = 8;

const getRecentIds = () => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const pushRecentId = (id) => {
  const updated = [id, ...getRecentIds().filter((existingId) => existingId !== id)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
};

const SECTIONS = [
  { id: 'recent', label: 'Recent' },
  { id: 'starred', label: 'Starred' },
  { id: 'all', label: 'All' },
];

const SelectWorkspaceModal = ({ workspaces, activeWorkspace, onClose, onSwitch, onCreated, onWorkspaceUpdated }) => {
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('recent');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [recentIds] = useState(getRecentIds);

  const sectioned = useMemo(() => {
    if (section === 'starred') return workspaces.filter((ws) => ws.starred);
    if (section === 'recent') {
      const recent = recentIds.map((id) => workspaces.find((ws) => ws.id === id)).filter(Boolean);
      return recent.length > 0 ? recent : workspaces;
    }
    return workspaces;
  }, [workspaces, section, recentIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sectioned;
    return sectioned.filter(
      (ws) => ws.name.toLowerCase().includes(q) || ws.slug.toLowerCase().includes(q) || ws.id.toLowerCase().includes(q)
    );
  }, [sectioned, query]);

  const handleSwitch = (workspace) => {
    pushRecentId(workspace.id);
    onSwitch(workspace);
    onClose();
  };

  const handleToggleStar = async (e, workspace) => {
    e.stopPropagation();
    try {
      const response = await api.patch(`/workspaces/${workspace.id}/star`, { starred: !workspace.starred });
      onWorkspaceUpdated(response.data);
    } catch (err) {
      console.error('Failed to update starred workspace', err);
    }
  };

  const handleCreated = (workspace) => {
    setShowCreateModal(false);
    onCreated(workspace);
    onClose();
  };

  return (
    <ModalPortal onClose={onClose} wide>
      <div className="gc-modal-header">
        <span className="gc-modal-title">Select a workspace</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button type="button" className="gc-btn gc-btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={14} />
            New Workspace
          </button>
          <button className="gc-modal-close" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <Search
          size={14}
          style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--vc-text-muted)' }}
        />
        <input
          type="text"
          autoFocus
          className="gc-input"
          placeholder="Search workspaces..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: '32px' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: '1px solid var(--vc-border)' }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: section === s.id ? '2px solid var(--vc-blue)' : '2px solid transparent',
              color: section === s.id ? 'var(--vc-blue)' : 'var(--vc-text-muted)',
              fontWeight: 600,
              fontSize: '13px',
              padding: '8px 10px',
              cursor: 'pointer',
              marginBottom: '-1px',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="gc-ws-select-list">
        {filtered.length === 0 ? (
          <div className="gc-empty" style={{ border: 'none' }}>
            {workspaces.length === 0
              ? "You don't belong to any workspaces yet."
              : section === 'starred'
              ? 'No starred workspaces yet — click the star on a workspace to pin it here.'
              : 'No workspaces match your search.'}
          </div>
        ) : (
          filtered.map((ws) => {
            const isActive = activeWorkspace?.id === ws.id;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => handleSwitch(ws)}
                className={`gc-ws-select-row ${isActive ? 'active' : ''}`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <Building2 size={14} style={{ color: 'var(--vc-text-muted)', flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <div className="gc-ws-item-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ws.name}
                    </div>
                    <div className="gc-ws-item-slug" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ws.slug} <span style={{ fontFamily: 'monospace' }}>· {ws.id}</span>
                    </div>
                  </span>
                </span>

                <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleToggleStar(e, ws)}
                    title={ws.starred ? 'Unstar workspace' : 'Star workspace'}
                    style={{ display: 'flex', cursor: 'pointer', color: ws.starred ? '#f59e0b' : 'var(--vc-text-muted)' }}
                  >
                    <Star size={15} fill={ws.starred ? '#f59e0b' : 'none'} />
                  </span>
                  {isActive && <Check size={15} style={{ color: 'var(--vc-blue)' }} />}
                </span>
              </button>
            );
          })
        )}
      </div>

      {showCreateModal && (
        <CreateWorkspaceModal onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
      )}
    </ModalPortal>
  );
};

export default SelectWorkspaceModal;
