/* Copyright 2017-present, The Visdom Authors */
import React, { useState } from 'react';
import { Building2, LogOut, Trash2 } from 'lucide-react';
import { api } from '../../context/AuthContext';

const WorkspaceSettingsTab = ({ workspace, isAdmin, currentUserId, onDeleted, onLeave }) => {
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  const isOwner = workspace.created_by === currentUserId;

  const handleDelete = async () => {
    if (!window.confirm(`Delete workspace "${workspace.name}"? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    setError('');
    try {
      await api.delete(`/workspaces/${workspace.id}`);
      onDeleted(workspace.id);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to delete workspace.');
      setDeleting(false);
    }
  };

  const handleLeave = async () => {
    if (!window.confirm(`Leave workspace "${workspace.name}"?`)) {
      return;
    }

    setLeaving(true);
    setError('');
    try {
      await api.delete(`/workspaces/${workspace.id}/members/${currentUserId}`);
      onLeave(workspace.id);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to leave workspace.');
      setLeaving(false);
    }
  };

  return (
    <section className="gc-panel">
      <div className="gc-panel-header">
        <span className="gc-panel-title">
          <Building2 size={15} />
          Workspace Settings
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div>
          <div className="gc-label" style={{ marginBottom: '4px' }}>Name</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--vc-text)' }}>{workspace.name}</div>
        </div>
        <div>
          <div className="gc-label" style={{ marginBottom: '4px' }}>Slug</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--vc-text)' }}>{workspace.slug}</div>
        </div>
        <div>
          <div className="gc-label" style={{ marginBottom: '4px' }}>Workspace ID</div>
          <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--vc-text-muted)', wordBreak: 'break-all' }}>
            {workspace.id}
          </div>
        </div>
      </div>

      {error && <div className="gc-form-error">{error}</div>}

      <div style={{ borderTop: '1px solid var(--vc-border)', paddingTop: '16px', marginBottom: isAdmin ? '16px' : 0 }}>
        <div className="gc-panel-title" style={{ fontSize: '13px', marginBottom: '8px' }}>
          Membership
        </div>
        <p className="gc-panel-sub">
          {isOwner
            ? "You created this workspace. You can leave at any time — no one else can remove you."
            : 'You can leave this workspace at any time.'}
        </p>
        <button className="gc-btn" onClick={handleLeave} disabled={leaving} type="button">
          <LogOut size={13} />
          {leaving ? 'Leaving...' : 'Leave Workspace'}
        </button>
      </div>

      {isAdmin && (
        <div style={{ borderTop: '1px solid var(--vc-border)', paddingTop: '16px' }}>
          <div className="gc-panel-title" style={{ fontSize: '13px', color: 'var(--vc-danger)', marginBottom: '8px' }}>
            Danger Zone
          </div>
          <p className="gc-panel-sub">
            Deleting a workspace permanently removes all memberships and shared links associated with it.
          </p>
          <button className="gc-btn gc-btn-danger" onClick={handleDelete} disabled={deleting} type="button">
            <Trash2 size={13} />
            {deleting ? 'Deleting...' : 'Delete Workspace'}
          </button>
        </div>
      )}
    </section>
  );
};

export default WorkspaceSettingsTab;
