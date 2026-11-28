import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { describeError, isSupabaseConfigured, supabase } from '@/lib/supabase';
import { claimWorkspace, fetchWorkspaceStatus, signIn, signOut } from '@/data/remote';
import { browserStore, clearCache, isNetworkFailure, readCache, readOutbox, writeOutbox } from '@/data/offline';
import { LogoMark } from '@/ui/icons';

type Phase =
  | { kind: 'local' }
  | { kind: 'checking' }
  | { kind: 'signed-out'; error: string | null }
  | { kind: 'unreachable'; error: string }
  | { kind: 'no-workspace' }
  | { kind: 'unclaimed'; businessId: string; displayName: string }
  | { kind: 'outsider'; displayName: string }
  | { kind: 'member'; email: string };

type AuthValue = {
  mode: 'local' | 'remote';
  email: string | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({ mode: 'local', email: null, signOut: async () => undefined });

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(() => (isSupabaseConfigured ? { kind: 'checking' } : { kind: 'local' }));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setPhase({ kind: 'local' });
      return;
    }

    const session = await supabase.auth.getSession();
    if (session.error) {
      setPhase({ kind: 'unreachable', error: describeError(session.error) });
      return;
    }
    const user = session.data.session?.user;
    if (!user) {
      setPhase({ kind: 'signed-out', error: null });
      return;
    }

    try {
      const status = await fetchWorkspaceStatus();
      if (!status) {
        setPhase({ kind: 'no-workspace' });
        return;
      }
      if (!status.claimed) {
        setPhase({ kind: 'unclaimed', businessId: status.businessId, displayName: status.displayName });
        return;
      }
      if (!status.isMember) {
        setPhase({ kind: 'outsider', displayName: status.displayName });
        return;
      }
      setPhase({ kind: 'member', email: user.email ?? '' });
    } catch (error) {
      // A member who is already signed in keeps working from the device copy when the
      // connection is what failed: refusing them would strand the job on site.
      if (isNetworkFailure(error) && readCache(browserStore())) {
        setPhase({ kind: 'member', email: user.email ?? '' });
        return;
      }
      setPhase({ kind: 'unreachable', error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });
    return () => data.subscription.unsubscribe();
  }, [resolve]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await signIn(email.trim(), password);
      setPassword('');
      await resolve();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async (businessId: string) => {
    setBusy(true);
    setFormError(null);
    try {
      await claimWorkspace(businessId);
      await resolve();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    const store = browserStore();
    const pending = readOutbox(store).length;
    if (
      pending > 0 &&
      !window.confirm(
        `${pending} change${pending === 1 ? ' is' : 's are'} still waiting to be sent. Signing out deletes them from this device. Sign out anyway?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await signOut();
    } finally {
      // Customer records must not stay readable on a signed-out device.
      clearCache(store);
      writeOutbox(store, []);
      setBusy(false);
      await resolve();
    }
  };

  if (phase.kind === 'member' || phase.kind === 'local') {
    return (
      <AuthContext.Provider
        value={{
          mode: phase.kind === 'local' ? 'local' : 'remote',
          email: phase.kind === 'member' ? phase.email : null,
          signOut: handleSignOut,
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <LogoMark size={26} />
          </span>
          <div>
            <strong>Sheet Set Pro</strong>
            <span>Mitchell&apos;s Metal Roofing</span>
          </div>
        </div>

        {phase.kind === 'checking' && <p className="muted">Checking your session…</p>}

        {phase.kind === 'signed-out' && (
          <form onSubmit={handleSignIn} className="auth-form">
            <h1>Sign in</h1>
            <p className="muted small">
              This workspace holds customer and commercial records. Only signed-in members can read them.
            </p>
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {formError && <p className="field-error">{formError}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="faint small">Accounts for this workspace are created in Supabase Auth.</p>
          </form>
        )}

        {phase.kind === 'unclaimed' && (
          <div className="auth-form">
            <h1>Claim this workspace</h1>
            <p className="muted small">
              <strong>{phase.displayName}</strong> has no owner yet. The first signed-in user becomes its owner; after
              that, access is by invitation only.
            </p>
            {formError && <p className="field-error">{formError}</p>}
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy}
              onClick={() => handleClaim(phase.businessId)}
            >
              {busy ? 'Claiming…' : 'Claim workspace'}
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={handleSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        )}

        {phase.kind === 'outsider' && (
          <div className="auth-form">
            <h1>No access</h1>
            <p className="muted small">
              You are signed in, but your account is not a member of {phase.displayName}. Ask the workspace owner to add
              you, or sign in with a different account.
            </p>
            <button className="btn btn-secondary" type="button" onClick={handleSignOut} disabled={busy}>
              Sign out
            </button>
          </div>
        )}

        {phase.kind === 'unreachable' && (
          <div className="auth-form">
            <h1>Cannot reach the workspace</h1>
            <p className="notice notice-danger">{phase.error}</p>
            <button className="btn btn-primary" type="button" onClick={() => resolve()}>
              Try again
            </button>
          </div>
        )}

        {phase.kind === 'no-workspace' && (
          <div className="auth-form">
            <h1>No workspace yet</h1>
            <p className="muted small">
              The database answered, but it has no workspace row. Apply the migrations in{' '}
              <span className="mono">supabase/migrations</span> to this project, then reload.
            </p>
            <button className="btn btn-primary" type="button" onClick={() => resolve()}>
              Check again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
