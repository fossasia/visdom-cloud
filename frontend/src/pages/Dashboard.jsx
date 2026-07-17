/* Copyright 2017-present, The Visdom Authors */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, api } from '../context/AuthContext';
import { Building2, CreditCard, ExternalLink, Key, LineChart, Link2, LogOut, User, Users } from 'lucide-react';
import WorkspaceSwitcher from '../components/workspace/WorkspaceSwitcher';
import WorkspaceSettingsTab from '../components/workspace/WorkspaceSettingsTab';
import MembersTab from '../components/workspace/MembersTab';
import SharedLinksTab from '../components/workspace/SharedLinksTab';
import KeysTab from '../components/workspace/KeysTab';
import BillingTab from '../components/workspace/BillingTab';
import PendingInvitesBanner from '../components/workspace/PendingInvitesBanner';
import ProfileModal from '../components/ProfileModal';

const TABS = [
  { id: 'workspaces', label: 'Workspaces', icon: Building2 },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'keys', label: 'Keys & API', icon: Key },
  { id: 'shared', label: 'Shared Links', icon: Link2 },
  { id: 'billing', label: 'Billing', icon: CreditCard },
];

const WORKSPACE_SCOPED_TABS = new Set(['workspaces', 'members', 'shared']);
const TAB_IDS = new Set(TABS.map((tab) => tab.id));
const ACTIVE_TAB_STORAGE_KEY = 'visdom-dashboard-active-tab';

const VISDOM_URL = import.meta.env.VITE_VISDOM_URL || 'http://localhost:8097';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const [initialStoredTab] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored && TAB_IDS.has(stored) ? stored : 'workspaces';
  });

  const wsParam = searchParams.get('ws');
  const tabParam = searchParams.get('tab');

  const activeTab = useMemo(() => {
    if (tabParam && TAB_IDS.has(tabParam)) return tabParam;
    return initialStoredTab;
  }, [tabParam, initialStoredTab]);

  const activeWorkspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    if (wsParam) {
      const found = workspaces.find((ws) => ws.slug === wsParam || ws.id === wsParam);
      if (found) return found;
    }
    return workspaces[0] || null;
  }, [workspaces, wsParam]);

  const isAdmin = activeWorkspace?.role === 'admin';

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const fetchWorkspaces = useCallback(() => {
    api
      .get('/workspaces')
      .then((response) => {
        setWorkspaces(response.data);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        setWorkspacesLoading(false);
      });
  }, []);

  const fetchPendingInvites = useCallback(() => {
    api
      .get('/workspaces/invites/pending')
      .then((response) => {
        setPendingInvites(response.data);
      })
      .catch((err) => {
        console.error(err);
      });
  }, []);

  useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
fetchWorkspaces();
    fetchPendingInvites();
  }, [fetchWorkspaces, fetchPendingInvites]);

  // Sync URL search parameters during initialization or when parameters are missing/invalid
  useEffect(() => {
    if (workspacesLoading || workspaces.length === 0) return;

    const expectedWsParam = activeWorkspace ? activeWorkspace.slug : '';
    const expectedTabParam = activeTab;

    if (wsParam !== expectedWsParam || tabParam !== expectedTabParam) {
      setSearchParams(
        { ...(expectedWsParam ? { ws: expectedWsParam } : {}), tab: expectedTabParam },
        { replace: true }
      );
    }
  }, [workspaces, workspacesLoading, activeWorkspace, activeTab, wsParam, tabParam, setSearchParams]);

  const handleWorkspaceSwitch = useCallback((ws) => {
    setSearchParams(
      { ...(ws ? { ws: ws.slug } : {}), tab: activeTab },
      { replace: false }
    );
  }, [activeTab, setSearchParams]);

  const handleTabClick = useCallback((tabId) => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
    const expectedWsParam = activeWorkspace ? activeWorkspace.slug : '';
    setSearchParams(
      { ...(expectedWsParam ? { ws: expectedWsParam } : {}), tab: tabId },
      { replace: false }
    );
  }, [activeWorkspace, setSearchParams]);

  const handleInviteAccepted = (workspaceId) => {
    setPendingInvites((prev) => prev.filter((inv) => inv.workspace.id !== workspaceId));
    setWorkspacesLoading(true);
    fetchWorkspaces();
  };

  const handleInviteDeclined = (workspaceId) => {
    setPendingInvites((prev) => prev.filter((inv) => inv.workspace.id !== workspaceId));
  };

  const handleWorkspaceCreated = (workspace) => {
    setWorkspaces((prev) => [...prev, workspace]);
    setSearchParams({ ws: workspace.slug, tab: 'workspaces' }, { replace: false });
  };

  const handleWorkspaceUpdated = (workspace) => {
    setWorkspaces((prev) =>
      prev.map((ws) => (ws.id === workspace.id ? workspace : ws))
    );
    if (activeWorkspace?.id === workspace.id && activeWorkspace.slug !== workspace.slug) {
      setSearchParams({ ws: workspace.slug, tab: activeTab }, { replace: true });
    }
  };

  const handleWorkspaceRemoved = (workspaceId) => {
    const remaining = workspaces.filter((ws) => ws.id !== workspaceId);
    setWorkspaces(remaining);
    const nextWs = activeWorkspace?.id === workspaceId ? remaining[0] || null : activeWorkspace;
    const expectedWsParam = nextWs ? nextWs.slug : '';
    setSearchParams(
      { ...(expectedWsParam ? { ws: expectedWsParam } : {}), tab: 'workspaces' },
      { replace: true }
    );
  };

  const needsWorkspace = WORKSPACE_SCOPED_TABS.has(activeTab) && !activeWorkspace;

  return (
    <div className="gc-shell">
      <aside className="gc-sidebar">
        <a href="/" className="gc-logo" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/logo.svg" alt="Visdom Logo" style={{ height: '24px', width: '24px', borderRadius: '4px' }} />
          <span>visdom</span>
        </a>

        {!workspacesLoading && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            onSwitch={handleWorkspaceSwitch}
            onCreated={handleWorkspaceCreated}
            onWorkspaceUpdated={handleWorkspaceUpdated}
          />
        )}

        <nav className="gc-sidebar-nav">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`gc-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => handleTabClick(tab.id)}
                type="button"
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}

          <a
            className="gc-tab gc-tab-viz"
            href={VISDOM_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the Visdom visualization dashboard in a new tab"
          >
            <LineChart size={15} />
            <span>Visualizations</span>
            <ExternalLink size={12} className="gc-tab-ext" />
          </a>
        </nav>

        <div className="gc-sidebar-footer">
          <button
            onClick={() => setShowProfileModal(true)}
            className="gc-sidebar-user gc-truncate gc-sidebar-user-btn"
            type="button"
            title="Edit profile"
          >
            <User size={13} />
            <span className="gc-sidebar-user-email">{user?.username || user?.email}</span>
          </button>
          <button onClick={logout} className="gc-btn" type="button">
            <LogOut size={13} />
            Logout
          </button>
        </div>
      </aside>

      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}

      <main className="gc-main">
        <PendingInvitesBanner
          invites={pendingInvites}
          currentUserId={user?.id}
          onAccepted={handleInviteAccepted}
          onDeclined={handleInviteDeclined}
        />

        {needsWorkspace ? (
          <section className="gc-panel">
            <div className="gc-empty">
              {workspaces.length === 0
                ? 'You don\'t have a workspace yet. Use "Add Workspace" in the sidebar to create your first one.'
                : 'Select a workspace from the sidebar to get started.'}
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

            {activeTab === 'keys' && <KeysTab workspaces={workspaces} />}

            {activeTab === 'shared' && activeWorkspace && (
              <SharedLinksTab workspaceId={activeWorkspace.id} isAdmin={isAdmin} />
            )}

            {activeTab === 'billing' && <BillingTab />}
          </>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
