import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { OfflineStatus } from '@/components/status/OfflineStatus';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';

export function AppShell() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
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

  const closeUserMenu = () => menuRef.current?.removeAttribute('open');

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
          <details className="user-menu" ref={menuRef}>
            <summary aria-label={`Open account menu for ${user?.displayName ?? 'student'}`}>
              <span className="user-menu__avatar" aria-hidden="true">
                {user?.displayName.slice(0, 1).toLocaleUpperCase()}
              </span>
              <span className="user-menu__name">{user?.displayName}</span>
              <span className="user-menu__chevron" aria-hidden="true">
                ⌄
              </span>
            </summary>
            <nav className="user-menu__popover" aria-label="Account">
              <Link to="/profile" onClick={closeUserMenu}>
                Profile
              </Link>
              <Link to="/settings" onClick={closeUserMenu}>
                Settings
              </Link>
              <button
                className="logout-button"
                onClick={() => {
                  closeUserMenu();
                  setConfirmingLogout(true);
                }}
              >
                Log out
              </button>
            </nav>
          </details>
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
      <ConfirmDialog
        open={confirmingLogout}
        title="Leave this session?"
        confirmLabel="Log out"
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={() => void handleLogout()}
      >
        Your progress will remain on this device. You can sign back in at any time.
      </ConfirmDialog>
    </div>
  );
}
