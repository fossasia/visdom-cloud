/* Copyright 2017-present, The Visdom Authors */
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../context/AuthContext';

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const CreateWorkspaceModal = ({ onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleNameChange = (e) => {
    const value = e.target.value;
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  };

  const handleSlugChange = (e) => {
    setSlugTouched(true);
    setSlug(slugify(e.target.value));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    setSubmitting(true);
    setError('');
    try {
      const response = await api.post('/workspaces', { name: name.trim(), slug: slug.trim() });
      onCreated(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to create workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-panel gc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gc-modal-header">
          <span className="gc-modal-title">Create Workspace</span>
          <button className="gc-modal-close" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>

        {error && <div className="gc-form-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="gc-field">
            <label className="gc-label">Workspace Name</label>
            <input
              type="text"
              required
              autoFocus
              className="gc-input"
              placeholder="NLP Labs"
              value={name}
              onChange={handleNameChange}
            />
          </div>

          <div className="gc-field">
            <label className="gc-label">Slug</label>
            <input
              type="text"
              required
              className="gc-input"
              placeholder="nlp-labs"
              value={slug}
              onChange={handleSlugChange}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="gc-btn gc-btn-primary"
            style={{ width: '100%', marginTop: '4px' }}
          >
            {submitting ? 'Creating...' : 'Create Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CreateWorkspaceModal;
