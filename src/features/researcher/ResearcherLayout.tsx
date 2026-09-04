import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/stores/auth.store';
import { ResearcherDataProvider } from './ResearcherDataContext';

const navigation = [
  { to: '/researcher', label: 'Dashboard', end: true },
  { to: '/researcher/participants', label: 'Participants' },
  { to: '/researcher/assessments', label: 'Assessments' },
  { to: '/researcher/lessons', label: 'Lessons' },
  { to: '/researcher/reports', label: 'Reports' },
];

export function ResearcherLayout() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const links = <>{navigation.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'is-active' : undefined}>{item.label}</NavLink>)}</>;
  const handleLogout = async () => { await logout(); navigate('/login', { replace: true }); };

  return (
    <div className="researcher-shell">
      <aside className="researcher-sidebar">
        <div className="researcher-sidebar__brand"><AltrasLogo linked={false} /><span>Research workspace</span></div>
        <nav aria-label="Researcher pages">{links}</nav>
        <div className="researcher-sidebar__account"><span>{user?.displayName ?? 'Researcher'}</span><button type="button" onClick={() => setConfirmingLogout(true)}>Log out</button></div>
      </aside>
      <details className="researcher-mobile-nav">
        <summary>Research menu</summary>
        <nav aria-label="Researcher pages mobile">{links}</nav>
      </details>
      <main className="researcher-main"><ResearcherDataProvider><Outlet /></ResearcherDataProvider></main>
      <ConfirmDialog open={confirmingLogout} title="Leave the research workspace?" confirmLabel="Log out" onCancel={() => setConfirmingLogout(false)} onConfirm={() => void handleLogout()}>Your session will end. You can sign back in at any time.</ConfirmDialog>
    </div>
  );
}
