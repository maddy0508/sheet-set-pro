import { useState } from 'react';
import type { ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { IconCatalogue, IconCustomers, IconDashboard, IconJobs, IconMenu, IconPlus, IconSettings, LogoMark } from '@/ui/icons';
import { useStore } from '@/data/store';
import { useAuth } from '@/auth/AuthGate';

type NavItem = { to: string; label: string; icon: ComponentType<{ size?: number; className?: string }>; end?: boolean };

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
  { to: '/jobs', label: 'Jobs', icon: IconJobs },
  { to: '/customers', label: 'Customers', icon: IconCustomers },
];

const SETUP_NAV: NavItem[] = [
  { to: '/catalogue', label: 'Product catalogue', icon: IconCatalogue },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

function crumbsFor(pathname: string, jobs: { id: string; jobNumber: string; title: string }[]): { label: string; to?: string }[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [{ label: 'Dashboard' }];
  const first = parts[0];
  const map: Record<string, string> = {
    jobs: 'Jobs',
    customers: 'Customers',
    catalogue: 'Product catalogue',
    settings: 'Settings',
  };
  const crumbs: { label: string; to?: string }[] = [{ label: map[first] ?? first, to: parts.length > 1 ? `/${first}` : undefined }];
  if (parts.length > 1) {
    const job = first === 'jobs' ? jobs.find((item) => item.id === parts[1]) : undefined;
    crumbs.push({ label: job ? job.jobNumber : parts[1] === 'new' ? 'New' : 'Detail' });
  }
  return crumbs;
}

type SyncChipProps = {
  sync: {
    status: 'loading' | 'ready' | 'saving' | 'error';
    lastSavedAt: string | null;
    offline: boolean;
    pending: number;
    savedCopyAt: string | null;
  };
};

function SyncChip({ sync }: SyncChipProps) {
  const pending = sync.pending;

  if (sync.status === 'error') {
    return (
      <span className="sync-chip sync-chip-error" title="A change was refused. See the notice below.">
        <span className="sync-dot" />
        Save failed
      </span>
    );
  }

  if (sync.offline) {
    return (
      <span
        className="sync-chip sync-chip-offline"
        title={
          pending > 0
            ? `${pending} change${pending === 1 ? '' : 's'} saved on this device and will be sent when the connection returns.`
            : 'Working from the copy saved on this device.'
        }
      >
        <span className="sync-dot" />
        {pending > 0 ? `Offline · ${pending} queued` : 'Offline · saved copy'}
      </span>
    );
  }

  if (pending > 0) {
    return (
      <span className="sync-chip sync-chip-saving" title={`${pending} change${pending === 1 ? '' : 's'} waiting to be sent.`}>
        <span className="sync-dot" />
        {`Sending ${pending}…`}
      </span>
    );
  }

  const label =
    sync.status === 'saving'
      ? 'Saving…'
      : sync.lastSavedAt
        ? `Saved ${new Date(sync.lastSavedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`
        : 'Connected';

  return (
    <span className={`sync-chip sync-chip-${sync.status}`} title="Records are stored in Supabase">
      <span className="sync-dot" />
      {label}
    </span>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { state, sync } = useStore();
  const auth = useAuth();
  const crumbs = crumbsFor(location.pathname, state.jobs);

  return (
    <div className="shell">
      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <span className="brand-mark">
            <LogoMark size={24} />
          </span>
          <span className="brand-text">
            <strong>Sheet Set Pro</strong>
            <span>Mitchell&apos;s Metal Roofing</span>
          </span>
        </div>

        <nav>
          <div className="nav-section">Operations</div>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              onClick={() => setMenuOpen(false)}
            >
              <Icon />
              {label}
            </NavLink>
          ))}

          <div className="nav-section">Setup</div>
          {SETUP_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              onClick={() => setMenuOpen(false)}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <strong>{state.company.displayName}</strong>
          {state.company.gstRegistered === null ? 'GST status not confirmed' : state.company.gstRegistered ? 'GST registered' : 'Not GST registered'}
          <br />
          {auth.mode === 'local' ? 'Local workspace · data stored on this device' : `Cloud workspace · ${auth.email ?? 'signed in'}`}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <button
              type="button"
              className="icon-btn nav-toggle"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              <IconMenu />
            </button>
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {index > 0 && <span className="crumbar-sep">/</span>}
                  {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span className="current">{crumb.label}</span>}
                </span>
              ))}
            </nav>
          </div>
          <div className="topbar-actions">
            {sync.mode === 'remote' && <SyncChip sync={sync} />}
            {auth.mode === 'remote' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void auth.signOut()}>
                Sign out
              </button>
            )}
            <Link to="/jobs?new=1" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              New job
            </Link>
          </div>
        </header>

        <main className="content">
          {sync.offline && sync.mode === 'remote' && (
            <div className="notice notice-info sync-error" role="status">
              <div>
                <strong>Working offline</strong>
                <p>
                  {sync.pending > 0
                    ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} saved on this device and will be sent when the connection returns.`
                    : sync.savedCopyAt
                      ? `Showing the workspace copy saved on this device at ${new Date(sync.savedCopyAt).toLocaleString('en-AU')}.`
                      : 'Showing the workspace copy saved on this device.'}
                </p>
              </div>
              <div className="sync-error-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={sync.retry}>
                  Try sending now
                </button>
              </div>
            </div>
          )}
          {sync.error && (
            <div className="notice notice-danger sync-error" role="alert">
              <div>
                <strong>Not saved</strong>
                <p>{sync.error}</p>
              </div>
              <div className="sync-error-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={sync.dismissError}>
                  Dismiss
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={sync.retry}>
                  Reload from database
                </button>
              </div>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
