/* Copyright 2017-present, The Visdom Authors */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Key, Plus, Terminal, Trash2, X } from 'lucide-react';
import { api } from '../../context/AuthContext';
import { EXPIRY_PRESETS, describeExpiry, parseApiError, resolveExpiresAt } from '../../utils/helpers';

const KeysTab = ({ workspaces = [] }) => {
  const [keys, setKeys] = useState([]);
  const [keyName, setKeyName] = useState('');
  const [scope, setScope] = useState('org');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState([]);
  const [expiryPreset, setExpiryPreset] = useState('none');
  const [customExpiresAt, setCustomExpiresAt] = useState('');
  const [newRawKey, setNewRawKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchKeys = useCallback(async () => {
    try {
      const response = await api.get('/keys');
      setKeys(response.data);
    } catch (err) {
      console.error('Error fetching API keys', err);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const toggleWorkspace = (workspaceId) => {
    setSelectedWorkspaceIds((prev) =>
      prev.includes(workspaceId) ? prev.filter((id) => id !== workspaceId) : [...prev, workspaceId]
    );
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    if (scope === 'workspace' && selectedWorkspaceIds.length === 0) {
      setError('Select at least one workspace, or choose "All workspaces" instead.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNewRawKey(null);

    try {
      const response = await api.post('/keys', {
        name: keyName,
        scope,
        workspace_ids: scope === 'workspace' ? selectedWorkspaceIds : [],
        expires_at: resolveExpiresAt(expiryPreset, customExpiresAt),
      });
      setNewRawKey(response.data.raw_key);
      setKeyName('');
      setScope('org');
      setSelectedWorkspaceIds([]);
      setExpiryPreset('none');
      setCustomExpiresAt('');
      fetchKeys();
    } catch (err) {
      setError(parseApiError(err, 'Failed to create API key.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeKey = async (id) => {
    if (!window.confirm('Are you sure you want to revoke this API key? This action is permanent.')) {
      return;
    }

    try {
      await api.delete(`/keys/${id}`);
      fetchKeys();
    } catch (err) {
      alert('Failed to revoke API key');
    }
  };

  const handleCopyKey = () => {
    if (!newRawKey) return;
    navigator.clipboard.writeText(newRawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="gc-flex-col-gap-lg">
      <section className="gc-panel">
        <div className="gc-panel-header">
          <span className="gc-panel-title">
            <Key size={15} />
            Developer API Keys
          </span>
        </div>

        <p className="gc-panel-sub">
          API keys allow automated remote pipelines (e.g., PyTorch training scripts) to connect and publish
          visualization logs securely to your workspaces.
        </p>

        <form onSubmit={handleCreateKey} className="gc-flex-col-gap-md">
          <div className="gc-field">
            <label className="gc-label">Key name</label>
            <input
              type="text"
              required
              className="gc-input"
              placeholder="Key name (e.g., GPU-Node-01)"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </div>

          <div className="gc-fields-row">
            <div className="gc-field gc-flex-1">
              <label className="gc-label">Access</label>
              <label className="gc-flex-row-gap-sm gc-radio-label">
                <input
                  type="radio"
                  name="key-scope"
                  checked={scope === 'org'}
                  onChange={() => setScope('org')}
                />
                <span>
                  <span className="gc-font-semibold">All workspaces</span>
                  <span className="gc-text-desc-muted"> — usable across every workspace you belong to, now and in the future</span>
                </span>
              </label>
              <label className="gc-flex-row-gap-sm gc-radio-label">
                <input
                  type="radio"
                  name="key-scope"
                  checked={scope === 'workspace'}
                  onChange={() => setScope('workspace')}
                />
                <span>
                  <span className="gc-font-semibold">Only select workspaces</span>
                  <span className="gc-text-desc-muted"> — restrict this key to specific workspaces</span>
                </span>
              </label>
            </div>

            <div className="gc-field gc-flex-1">
              <label className="gc-label">Expiration</label>
              <div className="gc-flex-row-center">
                <select
                  className="gc-select gc-flex-1"
                  value={expiryPreset}
                  onChange={(e) => setExpiryPreset(e.target.value)}
                >
                  {EXPIRY_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
              {expiryPreset === 'custom' && (
                <input
                  type="datetime-local"
                  className="gc-input gc-mt-sm"
                  value={customExpiresAt}
                  onChange={(e) => setCustomExpiresAt(e.target.value)}
                />
              )}
            </div>
          </div>

          {scope === 'workspace' && (
            <div className="gc-field">
              {workspaces.length === 0 ? (
                <div className="gc-empty gc-border-none">You don't belong to any workspaces yet.</div>
              ) : (
                <div className="gc-ws-select-list">
                  {workspaces.map((ws) => (
                    <label key={ws.id} className="gc-ws-select-row gc-cursor-pointer">
                      <span className="gc-flex-row-gap-sm-min-w">
                        <input
                          type="checkbox"
                          checked={selectedWorkspaceIds.includes(ws.id)}
                          onChange={() => toggleWorkspace(ws.id)}
                        />
                        <span className="gc-min-w-0">
                          <div className="gc-ws-item-name gc-truncate">{ws.name}</div>
                          <div className="gc-ws-item-slug gc-truncate">{ws.slug}</div>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <button type="submit" disabled={submitting} className="gc-btn gc-btn-primary gc-whitespace-nowrap">
              <Plus size={14} />
              Generate
            </button>
          </div>
        </form>

        {error && <div className="gc-form-error">{error}</div>}

        {newRawKey && (
          <div className="gc-form-success gc-success-box-column">
            <div className="gc-flex-row-between">
              <span className="gc-font-semibold">Secret API Key Generated</span>
              <button
                onClick={() => setNewRawKey(null)}
                className="gc-btn-unstyled-flex"
                type="button"
              >
                <X size={14} />
              </button>
            </div>
            <div className="gc-text-desc-muted">
              Please copy this key now. It will not be shown to you again for security reasons.
            </div>
            <div className="gc-raw-key-box">
              <span>{newRawKey}</span>
              <button
                onClick={handleCopyKey}
                className="gc-btn-unstyled-flex"
                type="button"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="gc-panel">
        <div className="gc-panel-header">
          <span className="gc-panel-title">
            <Terminal size={15} />
            Active Keys ({keys.length})
          </span>
        </div>

        {keys.length === 0 ? (
          <div className="gc-empty">No API keys generated yet.</div>
        ) : (
          <div>
            {keys.map((key) => {
              const expiry = describeExpiry(key.expires_at);
              return (
              <div key={key.id} className="gc-row">
                <div className="gc-min-w-0">
                  <div className="gc-row-main">{key.name}</div>
                  <div className="gc-row-meta">
                    <span>Prefix: {key.prefix}</span>
                    <span>Created: {new Date(key.created_at).toLocaleDateString()}</span>
                    {expiry.isExpired ? (
                      <span className="gc-badge gc-badge-expired">{expiry.text}</span>
                    ) : (
                      <span>{expiry.text}</span>
                    )}
                  </div>
                  <div className="gc-row-meta">
                    {key.scope === 'org' ? (
                      <span className="gc-badge gc-badge-admin">All workspaces</span>
                    ) : (
                      key.workspaces.map((ws) => (
                        <span key={ws.id} className="gc-badge gc-badge-member">{ws.name}</span>
                      ))
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleRevokeKey(key.id)}
                  className="gc-btn gc-btn-danger gc-btn-icon"
                  title="Revoke API Key"
                  type="button"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default KeysTab;
