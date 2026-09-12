import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth.store';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';
import { isCurrentUserAdmin } from './lesson-management.service';

export function AdminRoute({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id);
  const [result, setResult] = useState<{
    id: string;
    status: 'allowed' | 'denied' | 'error';
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useLayoutEffect(() => applyExperienceScope('neutral'), []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void isCurrentUserAdmin()
      .then((allowed) => {
        if (active) setResult({ id: userId, status: allowed ? 'allowed' : 'denied' });
      })
      .catch(() => {
        if (active) setResult({ id: userId, status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [userId, retry]);
  if (!userId || result?.id !== userId) return <LoadingState variant="screen" />;
  if (result.status !== 'allowed')
    return (
      <main className="researcher-state panel">
        <h1>
          {result.status === 'denied' ? 'Admin access required' : 'Unable to verify admin access'}
        </h1>
        <p>Lesson management requires explicit administrator authorization.</p>
        {result.status === 'error' && (
          <button className="button" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        )}
        <Link to="/">Return home</Link>
      </main>
    );
  return children;
}
