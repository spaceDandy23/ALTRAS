import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { OfflineStatus } from '@/components/status/OfflineStatus';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { db } from '@/db/database';
import {
  applyVisualPreferences,
  clearVisualPreferences,
  resolveTheme,
} from '@/features/settings/apply-preferences';
import { getUserSettings } from '@/features/settings/settings.service';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';

export function AppShell() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const researcherStatus = useResearcherAccessStore((state) => state.status);
  const checkResearcherAccess = useResearcherAccessStore((state) => state.checkAccess);
  const navigate = useNavigate();
  useEffect(() => {
    if (!user) return;
    let active = true;
    const colorScheme =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const applySystemTheme = () => {
      const preference = document.documentElement.dataset.themePreference;
      if (preference === 'light' || preference === 'dark' || preference === 'system') {
        document.documentElement.dataset.theme = resolveTheme(preference);
      }
    };

    void getUserSettings(db, user.id).then((loaded) => {
      if (!active) return;
      applyVisualPreferences(loaded);
    });
    colorScheme?.addEventListener('change', applySystemTheme);

    return () => {
      active = false;
      colorScheme?.removeEventListener('change', applySystemTheme);
    };
  }, [user]);

  useEffect(() => {
    if (user) void checkResearcherAccess(user.id);
  }, [checkResearcherAccess, user]);

  const handleLogout = async () => {
    await logout();
    clearVisualPreferences();
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
              {researcherStatus === 'authorized' && (
                <Link to="/researcher/results" onClick={closeUserMenu}>
                  Researcher results
                </Link>
              )}
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
