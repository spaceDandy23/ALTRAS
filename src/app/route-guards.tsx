import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'idle' || status === 'loading') return <AppLoading />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export function GuestOnlyRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  if (status === 'idle' || status === 'loading') return <AppLoading />;
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
    return <AppLoading message="Verifying account access…" />;
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
  return (
    <main className="loading-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-mark" aria-hidden="true">
        x + ?
      </div>
      <p>{message}</p>
    </main>
  );
}
