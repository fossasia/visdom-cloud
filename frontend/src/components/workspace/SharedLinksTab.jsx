/* Copyright 2017-present, The Visdom Authors */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Lock, Trash2 } from 'lucide-react';
import { api } from '../../context/AuthContext';
import { EXPIRY_PRESETS, ROLE_BADGE, parseApiError, resolveExpiresAt } from '../../utils/helpers';

const SharedLinksTab = ({ workspaceId, isAdmin }) => {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('member');
  const [expiryPreset, setExpiryPreset] = useState('none');
  const [customExpiresAt, setCustomExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(`/workspaces/${workspaceId}/share`);
      setLinks(response.data);
    } catch (err) {
      console.error('Error fetching shared links', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await api.post(`/workspaces/${workspaceId}/share`, {
        role,
        expires_at: resolveExpiresAt(expiryPreset, customExpiresAt),
        password: password.trim() || null,
        invite_email: inviteEmail.trim() || null,
      });
      setLinks((prev) => [...prev, response.data]);
      setRole('member');
      setExpiryPreset('none');
      setCustomExpiresAt('');
      setPassword('');
      setInviteEmail('');
    } catch (err) {
      setError(parseApiError(err, 'Failed to generate share link.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (linkId) => {
    if (!window.confirm('Revoke this share link? Anyone using it will lose access.')) return;
    try {
      await api.delete(`/workspaces/share/${linkId}`);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch (err) {
      alert('Failed to revoke share link.');
    }
  };

  const handleCopy = (link) => {
    const url = `${window.location.origin}/share/${link.id}`;
    navigator.clipboard.writeText(url);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <section className="gc-panel">
      <div className="gc-panel-header">
        <span className="gc-panel-title">
          <Link2 size={15} />
          Shared Links
        </span>
      </div>

      <p className="gc-panel-sub">
        Generate a link so people outside your workspace can request to join it. Opening the link sends a join
        request at the role you choose below — an admin still needs to approve it from the Members tab before
        access is granted.
      </p>

      {isAdmin && (
        <form
          onSubmit={handleCreate}
          className="gc-flex-row-end"
        >
          <div className="gc-flex-grow-140">
            <label className="gc-label">Joins as</label>
            <select className="gc-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div className="gc-flex-grow-140">
            <label className="gc-label">Expires</label>
            <select className="gc-select" value={expiryPreset} onChange={(e) => setExpiryPreset(e.target.value)}>
              {EXPIRY_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          {expiryPreset === 'custom' && (
            <div className="gc-flex-grow-180">
              <label className="gc-label">Custom date &amp; time</label>
              <input
                type="datetime-local"
                className="gc-input"
                value={customExpiresAt}
                onChange={(e) => setCustomExpiresAt(e.target.value)}
              />
            </div>
          )}
          <div className="gc-flex-grow-180">
            <label className="gc-label">Password (optional)</label>
            <input
              type="text"
              className="gc-input"
              placeholder="Leave blank for no password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="gc-flex-grow-180">
            <label className="gc-label">Email this link to (optional)</label>
            <input
              type="email"
              className="gc-input"
              placeholder="person@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <button type="submit" disabled={submitting} className="gc-btn gc-btn-primary gc-h-34">
            {submitting ? 'Generating...' : 'Generate Link'}
          </button>
        </form>
      )}

      {isAdmin && (
        <div className="gc-text-desc-muted gc-mt-sm">
          Note: email delivery isn't wired up to a provider yet — for now, copy the link below and send it yourself.
        </div>
      )}

      {error && <div className="gc-form-error">{error}</div>}

      {loading ? (
        <div className="gc-empty">Loading shared links...</div>
      ) : links.length === 0 ? (
        <div className="gc-empty">No active share links for this workspace.</div>
      ) : (
        <div>
          {links.map((link) => (
            <div key={link.id} className="gc-row">
              <div className="gc-min-w-0">
                <div className="gc-row-main gc-font-mono-small">
                  /share/{link.id}
                </div>
                <div className="gc-row-meta">
                  <span className={`gc-badge ${ROLE_BADGE[link.role] || 'gc-badge-member'}`}>Joins as {link.role}</span>
                  <span>{link.expires_at ? `Expires ${new Date(link.expires_at).toLocaleString()}` : 'Never expires'}</span>
                  {link.has_password && (
                    <span className="gc-badge gc-badge-viewer">
                      <Lock size={10} />
                      Protected
                    </span>
                  )}
                  {link.invite_email && <span>Sent to: {link.invite_email}</span>}
                </div>
              </div>

              <div className="gc-actions-row">
                <button className="gc-btn gc-btn-icon" onClick={() => handleCopy(link)} title="Copy link" type="button">
                  {copiedId === link.id ? <Check size={13} /> : <Copy size={13} />}
                </button>
                {isAdmin && (
                  <button
                    className="gc-btn gc-btn-danger gc-btn-icon"
                    onClick={() => handleRevoke(link.id)}
                    title="Revoke link"
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default SharedLinksTab;
