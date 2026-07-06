/* Copyright 2017-present, The Visdom Authors */
import React, { useState, useEffect } from 'react';
import { useAuth, api } from '../context/AuthContext';
import {
  Key, Plus, Trash2, LogOut, Check, Copy, User as UserIcon, Terminal, X
} from 'lucide-react';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [keys, setKeys] = useState([]);
  const [keyName, setKeyName] = useState('');
  const [healthStatus, setHealthStatus] = useState('checking');
  const [newRawKey, setNewRawKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchKeys = async () => {
    try {
      const response = await api.get('/keys');
      setKeys(response.data);
    } catch (err) {
      console.error('Error fetching API keys', err);
    }
  };

  const checkHealth = async () => {
    try {
      const response = await api.get('/health');
      if (response.data.status === 'healthy') {
        setHealthStatus('connected');
      } else {
        setHealthStatus('disconnected');
      }
    } catch (err) {
      setHealthStatus('disconnected');
    }
  };

  useEffect(() => {
    fetchKeys();
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

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
      setError(err.response?.data?.detail || 'Failed to create API key.');
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

      {/* 1. Visdom-themed Top Navbar */}
      <nav className="visdom-navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <a href="/" className="visdom-logo">
            visdom<span>cloud</span>
          </a>
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Console Dashboard
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Status Indicator matching the "offline" style in Visdom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {healthStatus === 'connected' ? (
              <span className="visdom-badge badge-online">online</span>
            ) : (
              <span className="visdom-badge badge-offline">offline</span>
            )}
          </div>

          <button onClick={logout} className="visdom-btn" style={{ height: '24px', padding: '0 8px' }}>
            <LogOut size={12} />
            Logout
          </button>
        </div>
      </nav>

      {/* 2. Floating Panes Workspace (Visdom Blue Background) */}
      <div style={{
        flex: 1,
        padding: '24px',
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        gap: '20px',
        alignItems: 'start',
      }}>

        {/* User profile pane */}
        <aside className="visdom-panel" style={{ height: 'auto' }}>
          <div className="visdom-panel-header">
            <span>User Account</span>
            <UserIcon size={14} style={{ color: 'var(--text-muted)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }}>
            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Email Address</div>
              <div style={{ fontWeight: '600', wordBreak: 'break-all' }}>{user?.email}</div>
            </div>

            <div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '6px' }}>Active Plan</div>
              <span className="badge badge-success" style={{
                background: '#e2f0d9',
                color: '#385723',
                border: '1px solid #c5e0b4',
                padding: '2px 8px',
                borderRadius: '2px',
                fontSize: '11px',
                fontWeight: '600',
                textTransform: 'uppercase'
              }}>{user?.tier} plan</span>
            </div>
          </div>
        </aside>

        {/* API keys management pane */}
        <main style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* API Key Console */}
          <section className="visdom-panel">
            <div className="visdom-panel-header">
              <span>Developer API Keys</span>
              <Key size={14} style={{ color: 'var(--text-muted)' }} />
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: '1.4' }}>
              API keys allow automated remote pipelines (e.g., PyTorch training scripts) to connect and publish visualization logs securely to your workspaces.
            </p>

            <form onSubmit={handleCreateKey} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input
                type="text"
                required
                className="visdom-input"
                placeholder="Key name (e.g., GPU-Node-01)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" disabled={submitting} className="visdom-btn" style={{
                backgroundColor: '#3b5998',
                color: '#ffffff',
                borderColor: '#2f477a',
                whiteSpace: 'nowrap'
              }}>
                <Plus size={14} />
                Generate
              </button>
            </form>

            {error && (
              <div style={{
                background: 'rgba(217, 83, 79, 0.1)',
                border: '1px solid var(--danger-bg)',
                color: 'var(--danger-bg)',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '2px',
                marginBottom: '16px'
              }}>
                {error}
              </div>
            )}

            {/* Secure Copy Key Dialog */}
            {newRawKey && (
              <div className="visdom-panel" style={{
                background: '#fafafa',
                borderColor: '#66afe9',
                padding: '16px',
                marginBottom: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                position: 'relative'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#337ab7' }}>
                    Secret API Key Generated
                  </span>
                  <button
                    onClick={() => setNewRawKey(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#333'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Please copy this key now. It will not be shown to you again for security reasons.
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#ffffff',
                  padding: '8px 12px',
                  borderRadius: '2px',
                  border: '1px solid var(--navbar-border)',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  justifyContent: 'space-between',
                  gap: '12px',
                  wordBreak: 'break-all'
                }}>
                  <span>{newRawKey}</span>
                  <button onClick={handleCopyKey} style={{
                    background: 'transparent',
                    border: 'none',
                    color: copied ? 'var(--success-bg)' : '#3b5998',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px'
                  }}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}

          </section>
          {/* Active Keys List Pane */}
          <section className="visdom-panel">
            <div className="visdom-panel-header">
              <span>Active Keys ({keys.length})</span>
              <Terminal size={14} style={{ color: 'var(--text-muted)' }} />
            </div>

            {keys.length === 0 ? (
              <div style={{
                border: '1px dashed var(--navbar-border)',
                borderRadius: '2px',
                padding: '24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px'
              }}>
                No API keys generated yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {keys.map((key) => (
                  <div key={key.id} className="key-item">
                    <div>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{key.name}</div>
                      <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        <span>Prefix: {key.prefix}</span>
                        <span>•</span>
                        <span>Created: {new Date(key.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRevokeKey(key.id)}
                      className="visdom-btn visdom-btn-danger"
                      style={{ height: '24px', width: '24px', padding: 0 }}
                      title="Revoke API Key"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

        </main>
      </div>

    </div>
  );
};

export default Dashboard;
