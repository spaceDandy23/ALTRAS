import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'idle' || status === 'loading') return <AuthenticatedBootstrapShell />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function AuthenticatedBootstrapShell() {
  return (
    <div className="app-shell auth-bootstrap-shell">
      <header className="app-header auth-bootstrap-shell__header">
        <AltrasLogo linked={false} />
        <div className="auth-bootstrap-shell__tools" aria-hidden="true">
          <span className="auth-bootstrap-shell__account" />
        </div>
      </header>
      <main className="app-content">
        <LoadingState variant="page" message="Opening your classroom…" />
      </main>
    </div>
  );
}

export function GuestOnlyRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  if (status === 'idle' || status === 'loading') {
    return <AppLoading message="" />;
  }
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

export function StudentRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const status = useResearcherAccessStore((state) => state.status);
  const checkedUserId = useResearcherAccessStore((state) => state.userId);
  const checkAccess = useResearcherAccessStore((state) => state.checkAccess);

  useEffect(() => {
    if (user) void checkAccess(user.id);
  }, [checkAccess, user]);

  if (!user || checkedUserId !== user.id || status === 'idle' || status === 'loading') {
    return <LoadingState variant="page" message="Verifying account access…" />;
  }

  if (status === 'authorized') return <Navigate to="/researcher/results" replace />;

  if (status === 'error') {
    return (
      <section className="researcher-state panel" aria-labelledby="student-access-error-title">
        <p className="researcher-kicker">Account access check</p>
        <h1 id="student-access-error-title">We couldn’t verify this account</h1>
        <p>
          Student activities stay locked until ALTRAS can confirm this is a participant account.
        </p>
        <Button onClick={() => void checkAccess(user.id)}>Try again</Button>
      </section>
    );
  }

  return children;
}

export function AppLoading({ message = 'Opening your classroom…' }: { message?: string }) {
  return <LoadingState variant="screen" message={message} />;
}
