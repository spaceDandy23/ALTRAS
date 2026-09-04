import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';

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
  useLayoutEffect(() => {
    if (status !== 'authenticated') applyExperienceScope('neutral');
  }, [status]);

  if (status === 'idle' || status === 'loading') {
    return <AppLoading />;
  }
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

export function ResolvedExperienceRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const status = useResearcherAccessStore((state) => state.status);
  const checkedUserId = useResearcherAccessStore((state) => state.userId);
  const checkAccess = useResearcherAccessStore((state) => state.checkAccess);
  const resolvedForUser = Boolean(user && checkedUserId === user.id);
  const scope =
    resolvedForUser && status === 'authorized'
      ? 'researcher'
      : resolvedForUser && status === 'denied'
        ? 'student'
        : 'neutral';

  useLayoutEffect(() => applyExperienceScope(scope), [scope]);
  useEffect(() => {
    if (user) void checkAccess(user.id);
  }, [checkAccess, user]);

  if (!resolvedForUser || status === 'idle' || status === 'loading') return <AppLoading />;
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
    return <LoadingState variant="page" />;
  }

  if (status === 'authorized') return <Navigate to="/researcher" replace />;

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

export function AppLoading({ message }: { message?: string }) {
  return <LoadingState variant="screen" message={message} />;
}
