import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Outlet, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { OfflineStatus } from '@/components/status/OfflineStatus';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';

export function AppShell() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const persistedSettings = useLiveQuery(
    () => (user ? db.settings.where('userId').equals(user.id).first() : undefined),
    [user?.id],
  );

  useEffect(() => {
    if (!persistedSettings) return;
    document.documentElement.dataset.motion = persistedSettings.animationsEnabled ? 'on' : 'off';
  }, [persistedSettings]);

  const handleLogout = async () => {
    await logout();
    delete document.documentElement.dataset.motion;
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <div className="chalk-doodles" aria-hidden="true">
        <span className="doodle doodle--one">x² + y²</span>
        <span className="doodle doodle--two">√144 = 12</span>
        <span className="doodle doodle--three">a ÷ b</span>
        <span className="doodle doodle--four">5(x + 2)</span>
      </div>
      <header className="app-header">
        <AltrasLogo />
        <div className="app-header__tools">
          <OfflineStatus />
          <span className="user-chip">
            <span aria-hidden="true">★</span> {user?.displayName}
          </span>
          <button className="logout-button" onClick={() => setConfirmingLogout(true)}>
            Log out
          </button>
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
      <footer className="app-footer">
        <span>Local device classroom</span>
        <span aria-hidden="true">•</span>
        <span>Offline learning</span>
      </footer>
      <ConfirmDialog
        open={confirmingLogout}
        title="Leave this session?"
        confirmLabel="Log out"
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={() => void handleLogout()}
      >
        Your work stays safely on this device. You can sign back in any time.
      </ConfirmDialog>
    </div>
  );
}
