import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { AlgebraicBackdrop } from '@/components/decorative/AlgebraicBackdrop';
import { OfflineStatus } from '@/components/status/OfflineStatus';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { resolveTheme } from '@/features/settings/apply-preferences';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import {
  getAudioMuted,
  playMusic,
  setAudioMuted,
  stopMusic,
} from '@/services/audio/audio.manager';
import { playNeutralClickOnKeyDown, playNeutralClickOnPointerDown } from '@/services/audio/click.handlers';

export function AppShell() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [audioMuted, setAudioMutedState] = useState(getAudioMuted);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const researcherStatus = useResearcherAccessStore((state) => state.status);
  const navigate = useNavigate();
  useEffect(() => {
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

    colorScheme?.addEventListener('change', applySystemTheme);

    return () => {
      colorScheme?.removeEventListener('change', applySystemTheme);
    };
  }, []);

  useEffect(() => {
    if (researcherStatus !== 'denied') {
      stopMusic();
      return;
    }
    playMusic('main');
    return stopMusic;
  }, [researcherStatus]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const closeUserMenu = () => menuRef.current?.removeAttribute('open');
  const toggleAudioMute = () => {
    const nextMuted = !audioMuted;
    setAudioMuted(nextMuted);
    setAudioMutedState(nextMuted);
  };

  return (
    <div className="app-shell">
      <AlgebraicBackdrop />
      <header className="app-header">
        <AltrasLogo />
        <div className="app-header__tools">
          <OfflineStatus />
          <button
            className="audio-mute-button"
            type="button"
            aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'}
            aria-pressed={audioMuted}
            onClick={toggleAudioMute}
          >
            <svg className="audio-mute-button__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
              {audioMuted ? (
                <path d="m17 9 4 6m0-6-4 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path d="M16 9.5a4 4 0 0 1 0 5m2-7.5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
          </button>
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
              <Link
                to="/profile"
                onPointerDown={playNeutralClickOnPointerDown}
                onKeyDown={playNeutralClickOnKeyDown}
                onClick={closeUserMenu}
              >
                Profile
              </Link>
              <Link
                to="/settings"
                onPointerDown={playNeutralClickOnPointerDown}
                onKeyDown={playNeutralClickOnKeyDown}
                onClick={closeUserMenu}
              >
                Settings
              </Link>
              <button
                className="logout-button"
                onPointerDown={playNeutralClickOnPointerDown}
                onKeyDown={playNeutralClickOnKeyDown}
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
