/* Copyright 2017-present, The Visdom Authors */
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth, api } from '../context/AuthContext';
import { Building2, CreditCard, Key, Link2, LogOut, Users } from 'lucide-react';
import WorkspaceSwitcher from '../components/workspace/WorkspaceSwitcher';
import WorkspaceSettingsTab from '../components/workspace/WorkspaceSettingsTab';
import MembersTab from '../components/workspace/MembersTab';
import SharedLinksTab from '../components/workspace/SharedLinksTab';
import KeysTab from '../components/workspace/KeysTab';
import BillingTab from '../components/workspace/BillingTab';

const TABS = [
  { id: 'workspaces', label: 'Workspaces', icon: Building2 },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'keys', label: 'Keys & API', icon: Key },
  { id: 'shared', label: 'Shared Links', icon: Link2 },
  { id: 'billing', label: 'Billing', icon: CreditCard },
];

const WORKSPACE_SCOPED_TABS = new Set(['workspaces', 'members', 'shared']);

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState('workspaces');

  const fetchWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true);
    try {
      const response = await api.get('/workspaces');
      setWorkspaces(response.data);
      setActiveWorkspace((prev) => {
        if (prev && response.data.some((ws) => ws.id === prev.id)) return prev;
        return response.data[0] || null;
      });
    } catch (err) {
      console.error('Error fetching workspaces', err);
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Determine whether the current user is an admin of the active workspace,
  // to gate admin-only actions across tabs.
  useEffect(() => {
    if (!activeWorkspace || !user) {
      setIsAdmin(false);
      return;
    }

    let cancelled = false;
    api
      .get(`/workspaces/${activeWorkspace.id}/members`)
      .then((response) => {
        if (cancelled) return;
        const self = response.data.find((m) => m.user_id === user.id);
        setIsAdmin(self?.role === 'admin');
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, user]);

  const handleWorkspaceCreated = (workspace) => {
    setWorkspaces((prev) => [...prev, workspace]);
    setActiveWorkspace(workspace);
    setActiveTab('workspaces');
  };

  // Shared by "delete workspace" (admin) and "leave workspace" (any member) —
  // both mean this workspace should disappear from my own list right away.
  const handleWorkspaceRemoved = (workspaceId) => {
    setWorkspaces((prev) => {
      const remaining = prev.filter((ws) => ws.id !== workspaceId);
      setActiveWorkspace(remaining[0] || null);
      return remaining;
    });
    setActiveTab('workspaces');
  };

  const needsWorkspace = WORKSPACE_SCOPED_TABS.has(activeTab) && !activeWorkspace;

  return (
    <div className="gc-shell">
      <aside className="gc-sidebar">
        <a href="/" className="gc-logo">
          visdom<span>cloud</span>
        </a>

        {!workspacesLoading && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            onSwitch={setActiveWorkspace}
            onCreated={handleWorkspaceCreated}
          />
        )}

        <nav className="gc-sidebar-nav">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`gc-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="gc-sidebar-footer">
          <div className="gc-sidebar-user">{user?.email}</div>
          <button onClick={logout} className="gc-btn" type="button">
            <LogOut size={13} />
            Logout
          </button>
        </div>
      </aside>

      <main className="gc-main">
        {needsWorkspace ? (
          <section className="gc-panel">
            <div className="gc-empty">
              You don't have a workspace yet. Use "Add Workspace" in the sidebar to create your first one.
            </div>
          </section>
        ) : (
          <>
            {activeTab === 'workspaces' && activeWorkspace && (
              <WorkspaceSettingsTab
                workspace={activeWorkspace}
                isAdmin={isAdmin}
                currentUserId={user?.id}
                onDeleted={handleWorkspaceRemoved}
                onLeave={handleWorkspaceRemoved}
              />
            )}

            {activeTab === 'members' && activeWorkspace && (
              <MembersTab
                workspaceId={activeWorkspace.id}
                currentUserId={user?.id}
                isAdmin={isAdmin}
                ownerId={activeWorkspace.created_by}
              />
            )}

            {activeTab === 'keys' && <KeysTab />}

            {activeTab === 'shared' && activeWorkspace && (
              <SharedLinksTab workspaceId={activeWorkspace.id} isAdmin={isAdmin} />
            )}

            {activeTab === 'billing' && <BillingTab user={user} />}
          </>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
