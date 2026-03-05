import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { DashboardPage } from './pages/Dashboard.js';
import { ExplorerPage } from './pages/Explorer.js';
import { AgentHubPage } from './pages/AgentHub.js';
import { AppsPage } from './pages/Apps.js';
import { SettingsPage } from './pages/Settings.js';
import { MessagesPage } from './pages/Messages.js';
import { AppHostPage, type InstalledApp } from './pages/AppHost.js';
import { ChatPanel } from './components/ChatPanel.js';

const NAV_MAIN = [
  {
    to: '/',
    end: true,
    label: 'Dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    to: '/explorer',
    label: 'Memory Explorer',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/>
        <line x1="8.5" y1="7.5" x2="15.5" y2="16.5"/>
        <line x1="15.5" y1="7.5" x2="8.5" y2="16.5"/>
      </svg>
    ),
  },
  {
    to: '/agent',
    label: 'Agent Hub',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
      </svg>
    ),
  },
  {
    to: '/messages',
    label: 'Messages',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
];

function useInstalledApps(): InstalledApp[] {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  useEffect(() => {
    const token = (window as any).__DKG_TOKEN__;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    fetch('/api/apps', { headers })
      .then(r => r.ok ? r.json() : [])
      .then(setApps)
      .catch(() => {});
  }, []);
  return apps;
}

function AppsNavItem({ installedApps }: { installedApps: InstalledApp[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const allApps = [
    {
      id: 'apps-hub',
      label: 'Browse Apps',
      desc: 'Discover, benchmark, connect',
      href: '/apps',
      icon: '📦',
    },
    ...installedApps.map(a => ({
      id: a.id,
      label: a.label,
      desc: a.description ?? '',
      href: `/app/${a.id}`,
      icon: '🎮',
    })),
  ];

  return (
    <div style={{ position: 'relative' }}>
      <div
        className="nav-btn"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>Apps</span>
        {installedApps.length > 0 && <span className="nav-badge">{installedApps.length}</span>}
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {open && (
        <div style={{
          position: 'absolute',
          left: '100%',
          top: 0,
          marginLeft: 8,
          width: 220,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex: 100,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 14px 6px', fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Apps
          </div>
          {allApps.map(app => (
            <button
              key={app.id}
              onClick={() => { setOpen(false); navigate(app.href); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '10px 14px',
                background: 'transparent', border: 'none',
                borderTop: '1px solid var(--border)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{app.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{app.label}</span>
                {app.desc && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>{app.desc}</div>}
              </div>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function App() {
  const installedApps = useInstalledApps();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">◆</div>
          <div>
            <div className="logo-text">DKG Node</div>
            <div className="logo-version">v9 TESTNET</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_MAIN.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-btn${isActive ? ' active' : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}

          <AppsNavItem installedApps={installedApps} />
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span className="pulse-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px rgba(74,222,128,0.4)', display: 'inline-block' }} />
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>Online</span>
            <span className="mono" style={{ color: 'var(--text-dim)', marginLeft: 'auto', fontSize: 10 }}>v9</span>
          </div>
          <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 10 }}>Base Sepolia Testnet</div>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/explorer/*" element={<ExplorerPage />} />
          <Route path="/agent" element={<AgentHubPage />} />
          <Route path="/apps/*" element={<AppsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/app/:appId" element={<AppHostPage apps={installedApps} />} />
        </Routes>
      </main>
      <ChatPanel />
    </div>
  );
}
