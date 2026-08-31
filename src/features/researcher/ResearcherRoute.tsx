import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { AppLoading } from '@/app/route-guards';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';

export function ResearcherRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const status = useResearcherAccessStore((state) => state.status);
  const checkAccess = useResearcherAccessStore((state) => state.checkAccess);

  useEffect(() => {
    if (user) void checkAccess(user.id);
  }, [checkAccess, user]);

  if (!user || status === 'idle' || status === 'loading') return <AppLoading />;

  if (status === 'denied') {
    return (
      <section className="researcher-state panel" aria-labelledby="researcher-access-title">
        <p className="researcher-kicker">Protected research area</p>
        <h1 id="researcher-access-title">Researcher access required</h1>
        <p>
          This account is not authorized to view anonymized participant results. No research data
          has been loaded.
        </p>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section className="researcher-state panel" aria-labelledby="researcher-access-error-title">
        <p className="researcher-kicker">Protected research area</p>
        <h1 id="researcher-access-error-title">We couldnâ€™t verify access</h1>
        <p>No participant results have been loaded. Check the connection and try again.</p>
        <Button onClick={() => user && void checkAccess(user.id)}>Try again</Button>
      </section>
    );
  }

  return children;
}
