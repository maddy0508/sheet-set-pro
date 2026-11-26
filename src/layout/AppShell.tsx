import { useState } from 'react';
import type { ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { IconCatalogue, IconCustomers, IconDashboard, IconJobs, IconMenu, IconPlus, IconSettings, LogoMark } from '@/ui/icons';
import { useStore } from '@/data/store';

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

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { state } = useStore();
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
          Local workspace · data stored on this device
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
            <Link to="/jobs?new=1" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              New job
            </Link>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
