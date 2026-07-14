/* Copyright 2017-present, The Visdom Authors */
import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { api, useAuth } from '../context/AuthContext';
import { useToast } from './toast/useToast';
import { parseApiError } from '../utils/helpers';
import ModalPortal from './ModalPortal';

const USERNAME_PATTERN = /^[a-z0-9_-]{3,30}$/;

const ProfileModal = ({ onClose }) => {
  const { user, setUser } = useAuth();
  const [username, setUsername] = useState(user?.username || '');
  const [usernameAvailable, setUsernameAvailable] = useState(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const isUnchanged = username === user?.username;

  useEffect(() => {
    if (isUnchanged || !username) {
      setUsernameAvailable(null);
      return;
    }

    if (!USERNAME_PATTERN.test(username)) {
      setUsernameAvailable(false);
      return;
    }

    setCheckingUsername(true);
    const timeout = setTimeout(async () => {
      try {
        const response = await api.get('/auth/username-availability', { params: { username } });
        setUsernameAvailable(response.data.available);
      } catch (err) {
        setUsernameAvailable(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [username, isUnchanged]);

  const canSubmit = !isUnchanged && USERNAME_PATTERN.test(username) && usernameAvailable === true;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');
    try {
      const response = await api.patch('/auth/me/username', { username });
      setUser(response.data);
      toast.success('Username updated.');
      onClose();
    } catch (err) {
      setError(parseApiError(err, 'Failed to update username.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div className="gc-modal-header">
        <span className="gc-modal-title">Profile</span>
        <button className="gc-modal-close" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>

      {error && <div className="gc-form-error">{error}</div>}

      <div className="gc-field">
        <label className="gc-label gc-mb-1">Email Address</label>
        <div className="gc-settings-value">{user?.email}</div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="gc-field">
          <label className="gc-label">Username</label>
          <input
            type="text"
            className="gc-input"
            value={username}
            onChange={(e) => setUsername(e.target.value.trim().toLowerCase())}
            autoComplete="off"
            spellCheck={false}
          />
          {!isUnchanged && username && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '12px' }}>
              {!USERNAME_PATTERN.test(username) ? (
                <span style={{ color: 'var(--danger-bg)' }}>
                  3-30 characters: lowercase letters, numbers, underscores, hyphens.
                </span>
              ) : checkingUsername ? (
                <span style={{ color: 'var(--text-muted)' }}>Checking availability...</span>
              ) : usernameAvailable ? (
                <span style={{ color: 'var(--success-bg)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={12} /> Available
                </span>
              ) : (
                <span style={{ color: 'var(--danger-bg)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <X size={12} /> Already taken
                </span>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="gc-btn gc-btn-primary gc-w-full gc-mt-1"
        >
          {submitting ? 'Saving...' : 'Save Username'}
        </button>
      </form>
    </ModalPortal>
  );
};

export default ProfileModal;
