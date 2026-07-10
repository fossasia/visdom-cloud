/* Copyright 2017-present, The Visdom Authors */
import React, { useState } from 'react';
import { Check, Mail, X } from 'lucide-react';
import { api } from '../../context/AuthContext';
import { parseApiError } from '../../utils/helpers';

const PendingInvitesBanner = ({ invites, currentUserId, onAccepted, onDeclined }) => {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  if (!invites || invites.length === 0) return null;

  const handleAccept = async (workspaceId) => {
    setBusyId(workspaceId);
    setError('');
    try {
      await api.post(`/workspaces/${workspaceId}/members/me/accept`);
      onAccepted(workspaceId);
    } catch (err) {
      setError(parseApiError(err, 'Failed to accept invite.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (workspaceId) => {
    if (!window.confirm('Decline this invitation?')) return;
    setBusyId(workspaceId);
    setError('');
    try {
      await api.delete(`/workspaces/${workspaceId}/members/${currentUserId}`);
      onDeclined(workspaceId);
    } catch (err) {
      setError(parseApiError(err, 'Failed to decline invite.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="gc-panel gc-mb-lg">
      <div className="gc-panel-header">
        <span className="gc-panel-title">
          <Mail size={15} />
          Pending Invitations ({invites.length})
        </span>
      </div>

      {error && <div className="gc-form-error">{error}</div>}

      <div>
        {invites.map((invite) => (
          <div key={invite.workspace.id} className="gc-row">
            <div>
              <div className="gc-row-main">{invite.workspace.name}</div>
              <div className="gc-row-meta">
                <span>You've been invited to join as {invite.role}</span>
              </div>
            </div>

            <div className="gc-flex-row-center">
              <button
                className="gc-btn gc-btn-primary gc-btn-icon"
                onClick={() => handleAccept(invite.workspace.id)}
                disabled={busyId === invite.workspace.id}
                title="Accept invite"
                type="button"
              >
                <Check size={13} />
              </button>
              <button
                className="gc-btn gc-btn-danger gc-btn-icon"
                onClick={() => handleDecline(invite.workspace.id)}
                disabled={busyId === invite.workspace.id}
                title="Decline invite"
                type="button"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default PendingInvitesBanner;
