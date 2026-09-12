import type { ReactNode } from 'react';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { OfflineStatus } from '@/components/status/OfflineStatus';

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth-screen">
      <div className="auth-screen__visual" aria-hidden="true">
        <div className="translation-demo">
          <span className="translation-demo__words">five more than a number</span>
          <span className="translation-demo__arrow">↓</span>
          <span className="translation-demo__math">x + 5</span>
        </div>
        <span className="floating-math floating-math--one">3n − 7</span>
        <span className="floating-math floating-math--two">÷</span>
        <span className="floating-math floating-math--three">2(x + 4)</span>
      </div>
      <section className="auth-card" aria-label="Account access">
        <div className="auth-card__topline">
          <AltrasLogo linked={false} />
          <OfflineStatus />
        </div>
        {children}
        <p className="local-account-note">
          <span aria-hidden="true">↻</span> Accounts and learning data sync across supported devices.
        </p>
      </section>
    </main>
  );
}
