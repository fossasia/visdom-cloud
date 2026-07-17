/* Copyright 2017-present, The Visdom Authors */
import React, { useMemo, useRef, useState } from 'react';
import { Building2, Check, Plus, Search, Star, X } from 'lucide-react';
import { api } from '../../context/AuthContext';
import ModalPortal from '../ModalPortal';
import CreateWorkspaceModal from './CreateWorkspaceModal';

const RECENT_KEY = 'visdom-recent-workspaces';
const MAX_RECENT = 8;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const getRecentIds = () => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw);
    const now = Date.now();
    const validItems = items.filter((item) => now - item.timestamp <= THREE_HOURS_MS);
    return validItems.map((item) => item.id);
  } catch {
    return [];
  }
};

const pushRecentId = (id) => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const items = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const filtered = items.filter((item) => item.id !== id && now - item.timestamp <= THREE_HOURS_MS);
    const updated = [{ id, timestamp: now }, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
};

const SECTIONS = [
  { id: 'recent', label: 'Recent' },
  { id: 'starred', label: 'Starred' },
  { id: 'all', label: 'All' },
];

const SelectWorkspaceModal = ({ workspaces = [], activeWorkspace, isLoading = false, onClose, onSwitch, onCreated, onWorkspaceUpdated }) => {
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('recent');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [recentIds] = useState(getRecentIds);

  const inputRef = useRef(null);
  const listRef = useRef(null);

  const sectioned = useMemo(() => {
    if (section === 'starred') return workspaces.filter((ws) => ws.starred);
    if (section === 'recent') {
      const recent = recentIds.map((id) => workspaces.find((ws) => ws.id === id)).filter(Boolean);
      return recent.length > 0 ? recent : workspaces;
    }
    return workspaces;
  }, [workspaces, section, recentIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sectioned;
    return sectioned.filter(
      (ws) => ws.name.toLowerCase().includes(q) || ws.slug.toLowerCase().includes(q) || ws.id.toLowerCase().includes(q)
    );
  }, [sectioned, query]);

  const handleSwitch = (workspace) => {
    pushRecentId(workspace.id);
    onSwitch(workspace);
    onClose();
  };

  const handleToggleStar = async (e, workspace) => {
    e.stopPropagation();
    try {
      const response = await api.patch(`/workspaces/${workspace.id}/star`, { starred: !workspace.starred });
      onWorkspaceUpdated(response.data);
    } catch (err) {
      console.error('Failed to update starred workspace', err);
    }
  };

  const handleCreated = (workspace) => {
    setShowCreateModal(false);
    onCreated(workspace);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      const items = Array.from(listRef.current?.querySelectorAll('.gc-ws-select-row:not([disabled])') || []);
      if (items.length === 0) return;

      const currentItem = items.find((item) => item === document.activeElement || item.contains(document.activeElement));
      const currentIndex = currentItem ? items.indexOf(currentItem) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (document.activeElement === inputRef.current || currentIndex === -1) {
          items[0]?.focus();
        } else if (currentIndex < items.length - 1) {
          items[currentIndex + 1]?.focus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentIndex > 0) {
          items[currentIndex - 1]?.focus();
        } else if (currentIndex === 0) {
          inputRef.current?.focus();
        }
      } else if (e.key === 'Home') {
        if (document.activeElement !== inputRef.current) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      } else if (e.key === 'End') {
        if (document.activeElement !== inputRef.current) {
          e.preventDefault();
          items[items.length - 1]?.focus();
        }
      }
    }
  };

  return (
    <ModalPortal onClose={onClose} wide>
      <div
        id="visdom-select-workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="select-workspace-title"
        onKeyDown={handleKeyDown}
      >
        <div className="gc-modal-header">
          <span id="select-workspace-title" className="gc-modal-title">Select a workspace</span>
          <div className="gc-flex-row-center">
            <button type="button" className="gc-btn gc-btn-primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={14} />
              New Workspace
            </button>
            <button className="gc-modal-close" onClick={onClose} type="button" aria-label="Close dialog">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="gc-mb-lg relative">
          <Search
            size={14}
            className="gc-absolute-search-icon"
          />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            className="gc-input gc-input-pl-search"
            placeholder="Search workspaces..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="gc-tabs-header-border">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`gc-tab-link-select ${section === s.id ? 'active' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div
          className="gc-ws-select-list"
          ref={listRef}
          role="listbox"
          aria-label="Available workspaces"
          aria-busy={isLoading ? 'true' : 'false'}
        >
          {isLoading ? (
            <div className="gc-flex-col-gap-md gc-p-sm" aria-label="Loading workspaces">
              {[1, 2, 3].map((i) => (
                <div key={i} className="gc-ws-select-row gc-skeleton-row" aria-hidden="true">
                  <span className="gc-flex-row-gap-sm-min-w gc-w-full">
                    <div className="gc-skeleton-block gc-skeleton-icon" />
                    <span className="gc-min-w-0 gc-w-full">
                      <div className="gc-skeleton-block gc-skeleton-title" />
                      <div className="gc-skeleton-block gc-skeleton-subtitle" />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="gc-empty gc-border-none">
              {workspaces.length === 0 ? (
                <>
                  <Building2 size={28} className="gc-text-muted gc-mx-auto gc-mb-1" />
                  <div className="gc-empty-title">No workspaces found</div>
                  <div className="gc-empty-desc">
                    You haven't created or joined any workspaces yet. Create your first workspace to get started.
                  </div>
                  <button
                    type="button"
                    className="gc-btn gc-btn-primary gc-mt-sm"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <Plus size={14} />
                    New Workspace
                  </button>
                </>
              ) : section === 'starred' ? (
                <>
                  <Star size={28} className="gc-text-star-inactive gc-mx-auto gc-mb-1" />
                  <div className="gc-empty-title">No starred workspaces</div>
                  <div className="gc-empty-desc">
                    Click the star icon next to any workspace to pin it here for quick access.
                  </div>
                </>
              ) : (
                <>
                  <Search size={28} className="gc-text-muted gc-mx-auto gc-mb-1" />
                  <div className="gc-empty-title">No matching workspaces</div>
                  <div className="gc-empty-desc">
                    We couldn't find any workspace matching "{query}".
                  </div>
                  {query && (
                    <button
                      type="button"
                      className="gc-btn gc-btn-sm gc-mt-sm"
                      onClick={() => setQuery('')}
                    >
                      Clear Search
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            filtered.map((ws) => {
              const isActive = activeWorkspace?.id === ws.id;
              return (
                <button
                  key={ws.id}
                  type="button"
                  role="option"
                  aria-selected={isActive ? 'true' : 'false'}
                  tabIndex={0}
                  onClick={() => handleSwitch(ws)}
                  className={`gc-ws-select-row ${isActive ? 'active' : ''}`}
                >
                  <span className="gc-flex-row-gap-sm-min-w">
                    <Building2 size={14} className="gc-shrink-0" />
                    <span className="gc-min-w-0">
                      <div className="gc-ws-item-name gc-truncate">
                        {ws.name}
                      </div>
                      <div className="gc-ws-item-slug gc-truncate">
                        {ws.slug} <span className="gc-font-mono">· {ws.id}</span>
                      </div>
                    </span>
                  </span>

                  <span className="gc-flex-row-gap-sm-min-w gc-shrink-0">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleToggleStar(e, ws)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleToggleStar(e, ws);
                        }
                      }}
                      title={ws.starred ? 'Unstar workspace' : 'Star workspace'}
                      className={`gc-btn-unstyled-flex ${ws.starred ? 'gc-text-star-active' : 'gc-text-star-inactive'}`}
                    >
                      <Star size={15} fill={ws.starred ? '#f59e0b' : 'none'} />
                    </span>
                    {isActive && <Check size={15} className="gc-text-blue" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateWorkspaceModal onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
      )}
    </ModalPortal>
  );
};

export default SelectWorkspaceModal;
