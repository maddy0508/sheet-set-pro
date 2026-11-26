import type { ReactNode } from 'react';
import { useStore } from '@/data/store';

/**
 * Keeps an empty screen from being mistaken for an empty workspace: until the
 * database has answered, nothing is shown.
 */
export function DataGate({ children }: { children: ReactNode }) {
  const { state, sync } = useStore();

  if (sync.mode === 'local') return <>{children}</>;

  if (sync.status === 'loading') {
    return (
      <div className="data-gate">
        <div className="card">
          <div className="card-body">
            <strong>Loading workspace…</strong>
            <p className="muted small">Reading customers, jobs and documents from the database.</p>
          </div>
        </div>
      </div>
    );
  }

  if (sync.status === 'error' && !state.company.id) {
    return (
      <div className="data-gate">
        <div className="card">
          <div className="card-body">
            <strong>The workspace could not be loaded</strong>
            <p className="notice notice-danger">{sync.error}</p>
            <button className="btn btn-primary" type="button" onClick={sync.retry}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
