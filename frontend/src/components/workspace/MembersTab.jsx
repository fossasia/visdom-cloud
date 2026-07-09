/* Copyright 2017-present, The Visdom Authors */
import React, { useCallback, useEffect, useState } from 'react';
import { Crown, UserPlus, Users, X } from 'lucide-react';
import { api } from '../../context/AuthContext';
import InviteMemberModal from './InviteMemberModal';
import { ROLE_BADGE, parseApiError } from '../../utils/helpers';

const MembersTab = ({ workspaceId, currentUserId, isAdmin, ownerId }) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(`/workspaces/${workspaceId}/members`);
      setMembers(response.data);
    } catch (err) {
      console.error('Error fetching members', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleInvited = (member) => {
    setShowInvite(false);
    setMembers((prev) => [...prev, member]);
  };

  const handleRoleChange = async (userId, role) => {
    setError('');
    try {
      const response = await api.put(`/workspaces/${workspaceId}/members/${userId}`, { role });
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? response.data : m)));
    } catch (err) {
      setError(parseApiError(err, 'Failed to update role.'));
    }
  };

  const handleRemove = async (userId) => {
    if (!window.confirm('Remove this member from the workspace?')) return;

    setError('');
    try {
      await api.delete(`/workspaces/${workspaceId}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err) {
      setError(parseApiError(err, 'Failed to remove member.'));
    }
  };

  return (
    <section className="gc-panel">
      <div className="gc-panel-header">
        <span className="gc-panel-title">
          <Users size={15} />
          Members ({members.length})
        </span>
        {isAdmin && (
          <button className="gc-btn gc-btn-primary" onClick={() => setShowInvite(true)} type="button">
            <UserPlus size={13} />
            Invite
          </button>
        )}
      </div>

      {error && <div className="gc-form-error">{error}</div>}

      {loading ? (
        <div className="gc-empty">Loading members...</div>
      ) : members.length === 0 ? (
        <div className="gc-empty">No members in this workspace yet.</div>
      ) : (
        <div>
          {members.map((m) => {
            const isSelf = m.user_id === currentUserId;
            const isOwner = m.user_id === ownerId;
            // Nobody can change their own role, and nobody but the workspace
            // owner's own creation locks their role permanently — so the
            // only rows an admin can manage are other, non-owner members.
            const canManage = isAdmin && !isSelf && !isOwner;
            return (
              <div key={m.user_id} className="gc-row">
                <div>
                  <div className="gc-row-main">{m.email}{isSelf && ' (you)'}</div>
                  <div className="gc-row-meta">
                    <span className={`gc-badge ${ROLE_BADGE[m.role] || 'gc-badge-member'}`}>{m.role}</span>
                    {isOwner && (
                      <span className="gc-badge gc-badge-admin">
                        <Crown size={10} />
                        Owner
                      </span>
                    )}
                  </div>
                </div>

                {canManage && (
                  <div className="gc-flex-row-center">
                    <select
                      className="gc-select gc-select-compact"
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      className="gc-btn gc-btn-danger gc-btn-icon gc-btn-icon-compact"
                      onClick={() => handleRemove(m.user_id)}
                      title="Remove member"
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showInvite && (
        <InviteMemberModal
          workspaceId={workspaceId}
          onClose={() => setShowInvite(false)}
          onInvited={handleInvited}
        />
      )}
    </section>
  );
};

export default MembersTab;
