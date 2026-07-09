/* Copyright 2017-present, The Visdom Authors */
import React, { useEffect, useState } from 'react';
import { Check, User as UserIcon, X } from 'lucide-react';
import { useAuth, api } from '../context/AuthContext';
import ModalPortal from './ModalPortal';

const USERNAME_PATTERN = /^[a-z0-9_-]{3,30}$/;

const ProfileModal = ({ onClose }) => {
  const { user, setUser } = useAuth();
  const [username, setUsername] = useState(user?.username || '');
  const [available, setAvailable] = useState(null); // null | true | false
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isUnchanged = username === user?.username;

  useEffect(() => {
    if (isUnchanged || !username) {
      setAvailable(null);
      return;
    }

    if (!USERNAME_PATTERN.test(username)) {
      setAvailable(false);
      return;
    }

    setChecking(true);
    const timeout = setTimeout(async () => {
      try {
        const response = await api.get('/auth/username-availability', { params: { username } });
        setAvailable(response.data.available);
      } catch (err) {
        setAvailable(null);
      } finally {
        setChecking(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const canSave = !isUnchanged && USERNAME_PATTERN.test(username) && available === true;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.patch('/auth/me/username', { username });
      setUser(response.data);
      setSuccess('Username updated.');
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to update username.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div className="gc-modal-header">
        <span className="gc-modal-title">
          <UserIcon size={15} style={{ marginRight: '6px', verticalAlign: '-2px' }} />
          Your Profile
        </span>
        <button className="gc-modal-close" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>

      <div className="gc-field">
        <label className="gc-label">Email</label>
        <div style={{ fontSize: '13px', color: 'var(--vc-text-muted)' }}>{user?.email}</div>
      </div>

      {error && <div className="gc-form-error">{error}</div>}
      {success && <div className="gc-form-success">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="gc-field">
          <label className="gc-label">Username</label>
          <input
            type="text"
            className="gc-input"
            value={username}
            onChange={(e) => {
              setSuccess('');
              setUsername(e.target.value.toLowerCase());
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {!isUnchanged && username && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '12px' }}>
              {!USERNAME_PATTERN.test(username) ? (
                <span style={{ color: 'var(--vc-danger)' }}>
                  3-30 characters: lowercase letters, numbers, underscores, hyphens.
                </span>
              ) : checking ? (
                <span style={{ color: 'var(--vc-text-muted)' }}>Checking availability...</span>
              ) : available ? (
                <span style={{ color: 'var(--vc-success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={12} /> Available
                </span>
              ) : (
                <span style={{ color: 'var(--vc-danger)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <X size={12} /> Already taken
                </span>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSave || saving}
          className="gc-btn gc-btn-primary"
          style={{ width: '100%', marginTop: '4px' }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </ModalPortal>
  );
};

export default ProfileModal;
