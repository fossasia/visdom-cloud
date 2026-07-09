/* Copyright 2017-present, The Visdom Authors */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Key, Plus, Terminal, Trash2, X } from 'lucide-react';
import { api } from '../../context/AuthContext';
import { parseApiError } from '../../utils/helpers';

const KeysTab = () => {
  const [keys, setKeys] = useState([]);
  const [keyName, setKeyName] = useState('');
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

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setSubmitting(true);
    setError('');
    setNewRawKey(null);

    try {
      const response = await api.post('/keys', { name: keyName });
      setNewRawKey(response.data.raw_key);
      setKeyName('');
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

        <form onSubmit={handleCreateKey} className="gc-flex-row-gap-md">
          <input
            type="text"
            required
            className="gc-input gc-flex-1"
            placeholder="Key name (e.g., GPU-Node-01)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
          />
          <button type="submit" disabled={submitting} className="gc-btn gc-btn-primary gc-whitespace-nowrap">
            <Plus size={14} />
            Generate
          </button>
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
            {keys.map((key) => (
              <div key={key.id} className="gc-row">
                <div>
                  <div className="gc-row-main">{key.name}</div>
                  <div className="gc-row-meta">
                    <span>Prefix: {key.prefix}</span>
                    <span>Created: {new Date(key.created_at).toLocaleDateString()}</span>
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default KeysTab;
