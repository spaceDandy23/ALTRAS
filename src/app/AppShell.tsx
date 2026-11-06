import { useEffect, useState } from 'react';
import { BookOpen, Home, LibraryBig, LogOut, Menu, Settings, UserRound, Volume2, VolumeX, X } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { AlgebraicBackdrop } from '@/components/decorative/AlgebraicBackdrop';
import { OfflineStatus } from '@/components/status/OfflineStatus';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { GlobalLessonSyncStatus } from '@/features/lessons/components/GlobalLessonSyncStatus';
import { resolveTheme } from '@/features/settings/apply-preferences';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { getAudioMuted, playMusic, setAudioMuted, stopMusic } from '@/services/audio/audio.manager';
import { playNeutralClickOnKeyDown, playNeutralClickOnPointerDown } from '@/services/audio/click.handlers';

export function AppShell() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [confirmingHome, setConfirmingHome] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [audioMuted, setAudioMutedState] = useState(getAudioMuted);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const researcherStatus = useResearcherAccessStore((state) => state.status);
  const navigate = useNavigate();
  const location = useLocation();
  const activeLessonMatch = location.pathname.match(/^\/lessons\/[^/]+\/play\/([^/]+)\/?$/);
  const activeLesson = Boolean(activeLessonMatch);

  useEffect(() => {
    const colorScheme = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const applySystemTheme = () => {
      const preference = document.documentElement.dataset.themePreference;
      if (preference === 'light' || preference === 'dark' || preference === 'system') {
        document.documentElement.dataset.theme = resolveTheme(preference);
      }
    };
    colorScheme?.addEventListener('change', applySystemTheme);
    return () => colorScheme?.removeEventListener('change', applySystemTheme);
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
  const requestHome = (event: React.MouseEvent<HTMLAnchorElement>) => {
    setMobileNavigationOpen(false);
    if (!activeLesson) return;
    event.preventDefault();
    setConfirmingHome(true);
  };
  const requestLogout = () => {
    setMobileNavigationOpen(false);
    setConfirmingLogout(true);
  };
  const toggleAudioMute = () => {
    const nextMuted = !audioMuted;
    setAudioMuted(nextMuted);
    setAudioMutedState(nextMuted);
  };

  return (
    <div className="app-shell">
      <AlgebraicBackdrop />
      <aside className="student-sidebar" aria-label="Student navigation">
        <AltrasLogo linked={!activeLesson} />
        <StudentNavigation user={user} audioMuted={audioMuted} onToggleAudio={toggleAudioMute} onHome={requestHome} onLogout={requestLogout} />
      </aside>
      {mobileNavigationOpen && (
        <div className="student-mobile-drawer" role="dialog" aria-modal="true" aria-label="Student navigation">
          <button className="student-mobile-drawer__close" type="button" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)}>
            <X aria-hidden="true" />
          </button>
          <AltrasLogo linked={!activeLesson} />
          <StudentNavigation
            user={user}
            audioMuted={audioMuted}
            onToggleAudio={toggleAudioMute}
            onHome={requestHome}
            onLogout={requestLogout}
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </div>
      )}
      <div className="app-shell__main">
        <header className="student-mobile-header">
          <button className="student-mobile-nav-toggle" type="button" aria-label="Open navigation" aria-expanded={mobileNavigationOpen} onClick={() => setMobileNavigationOpen(true)}>
            <Menu aria-hidden="true" />
          </button>
          <div className="app-header__mobile-logo"><AltrasLogo linked={!activeLesson} /></div>
        </header>
        <div className="student-status-region">
          <OfflineStatus />
          {user && <GlobalLessonSyncStatus userId={user.id} excludedAttemptId={activeLessonMatch?.[1]} />}
        </div>
        <main className="app-content"><Outlet /></main>
      </div>
      <ConfirmDialog open={confirmingHome} title="Leave active lesson?" confirmLabel="Go home" onCancel={() => setConfirmingHome(false)} onConfirm={() => { setConfirmingHome(false); navigate('/'); }}>
        Your submitted answers are saved. You can resume this lesson from Home or Lessons.
      </ConfirmDialog>
      <ConfirmDialog open={confirmingLogout} title="Leave this session?" confirmLabel="Log out" onCancel={() => setConfirmingLogout(false)} onConfirm={() => void handleLogout()}>
        Your progress will remain on this device. You can sign back in at any time.
      </ConfirmDialog>
    </div>
  );
}

function StudentNavigation({
  user,
  audioMuted,
  onToggleAudio,
  onHome,
  onLogout,
  onNavigate,
}: {
  user: ReturnType<typeof useAuthStore.getState>['user'];
  audioMuted: boolean;
  onToggleAudio: () => void;
  onHome: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const lessonsActive = pathname.startsWith('/lessons') && !pathname.startsWith('/lessons/almanac');
  const navProps = { onPointerDown: playNeutralClickOnPointerDown, onKeyDown: playNeutralClickOnKeyDown };
  return (
    <>
      <nav className="student-sidebar__nav" aria-label="Student pages">
        <NavLink end to="/" {...navProps} onClick={(event) => { onHome(event); onNavigate?.(); }}><Home aria-hidden="true" /> Home</NavLink>
        <NavLink end to="/lessons" {...navProps} aria-current={lessonsActive ? 'page' : undefined} onClick={onNavigate}><BookOpen aria-hidden="true" /> Lessons</NavLink>
        <NavLink to="/lessons/almanac" {...navProps} onClick={onNavigate}><LibraryBig aria-hidden="true" /> Almanac</NavLink>
      </nav>
      <div className="student-sidebar__account">
        <p><span aria-hidden="true">{user?.displayName.slice(0, 1).toLocaleUpperCase()}</span>{user?.displayName}</p>
        <button className="student-sidebar__audio" type="button" aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'} title={audioMuted ? 'Unmute audio' : 'Mute audio'} aria-pressed={audioMuted} onClick={onToggleAudio}>
          {audioMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          {audioMuted ? 'Unmute audio' : 'Mute audio'}
        </button>
        <NavLink to="/profile" {...navProps} onClick={onNavigate}><UserRound aria-hidden="true" /> Profile</NavLink>
        <NavLink to="/settings" {...navProps} onClick={onNavigate}><Settings aria-hidden="true" /> Settings</NavLink>
        <button type="button" onPointerDown={playNeutralClickOnPointerDown} onKeyDown={playNeutralClickOnKeyDown} onClick={onLogout}><LogOut aria-hidden="true" /> Log out</button>
      </div>
    </>
  );
}
