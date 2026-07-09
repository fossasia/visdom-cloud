/* Copyright 2017-present, The Visdom Authors */
import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '../../context/AuthContext';
import ModalPortal from '../ModalPortal';

const DeleteWorkspaceModal = ({ workspace, onClose, onDeleted }) => {
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isMatch = confirmText === workspace.name;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isMatch) return;

    setSubmitting(true);
    setError('');
    try {
      await api.delete(`/workspaces/${workspace.id}`);
      onDeleted(workspace.id);
      onClose();
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to delete workspace.');
      setSubmitting(false);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div className="gc-modal-header">
        <span className="gc-modal-title" style={{ color: 'var(--vc-danger)' }}>
          Delete Workspace
        </span>
        <button className="gc-modal-close" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '10px',
          background: 'rgba(217, 83, 79, 0.08)',
          border: '1px solid var(--vc-danger)',
          borderRadius: 'var(--vc-radius-sm)',
          padding: '12px',
          marginBottom: '16px',
        }}
      >
        <AlertTriangle size={16} style={{ color: 'var(--vc-danger)', flexShrink: 0, marginTop: '1px' }} />
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--vc-text)', lineHeight: 1.5 }}>
          This action <strong>cannot be undone</strong>. This will permanently delete the{' '}
          <strong>{workspace.name}</strong> workspace, along with all of its memberships, API access, and shared
          links.
        </p>
      </div>

      {error && <div className="gc-form-error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="gc-field">
          <label className="gc-label">
            Please type <strong>{workspace.name}</strong> to confirm.
          </label>
          <input
            type="text"
            autoFocus
            className="gc-input"
            placeholder={workspace.name}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <button
          type="submit"
          disabled={!isMatch || submitting}
          className="gc-btn gc-btn-danger"
          style={{ width: '100%', marginTop: '4px' }}
        >
          {submitting ? 'Deleting...' : 'I understand, delete this workspace'}
        </button>
      </form>
    </ModalPortal>
  );
};

export default DeleteWorkspaceModal;
