/* Copyright 2017-present, The Visdom Authors */
import React, { useState } from 'react';
import { Building2, LogOut, Trash2 } from 'lucide-react';
import { api } from '../../context/AuthContext';
import DeleteWorkspaceModal from './DeleteWorkspaceModal';
import { parseApiError } from '../../utils/helpers';

const WorkspaceSettingsTab = ({ workspace, isAdmin, currentUserId, onDeleted, onLeave }) => {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const isOwner = workspace.created_by === currentUserId;

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
      setError(parseApiError(err, 'Failed to leave workspace.'));
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

      <div className="gc-settings-grid">
        <div>
          <div className="gc-label gc-mb-1">Workspace Name</div>
          <div className="gc-settings-value">{workspace.name}</div>
        </div>
        <div>
          <div className="gc-label gc-mb-1">Slug</div>
          <div className="gc-settings-value">{workspace.slug}</div>
        </div>
        <div>
          <div className="gc-label gc-mb-1">Workspace ID</div>
          <div className="gc-settings-id">
            {workspace.id}
          </div>
        </div>
      </div>

      {error && <div className="gc-form-error">{error}</div>}

      <div className={`gc-border-section-t ${isAdmin ? 'gc-mb-lg' : 'mb-0'}`}>
        <div className="gc-panel-title gc-section-title-compact">
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
        <div className="gc-border-section-t">
          <div className="gc-panel-title gc-section-title-compact gc-text-danger">
            Danger Zone
          </div>
          <p className="gc-panel-sub">
            Deleting a workspace permanently removes all memberships and shared links associated with it.
          </p>
          <button className="gc-btn gc-btn-danger" onClick={() => setShowDeleteModal(true)} type="button">
            <Trash2 size={13} />
            Delete Workspace
          </button>
        </div>
      )}

      {showDeleteModal && (
        <DeleteWorkspaceModal
          workspace={workspace}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={onDeleted}
        />
      )}
    </section>
  );
};

export default WorkspaceSettingsTab;
