import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';

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

export function AppLoading() {
  return (
    <main className="loading-screen">
      <div className="loading-mark" aria-hidden="true">
        x + ?
      </div>
      <p>Opening your classroom…</p>
    </main>
  );
}
