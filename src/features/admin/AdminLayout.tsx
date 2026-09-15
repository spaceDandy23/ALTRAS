import { useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/stores/auth.store';
import './lesson-management.css';

export function AdminLayout() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);
  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand">
          <AltrasLogo linked={false} />
          <span>Administrator workspace</span>
        </div>
        <nav aria-label="Admin navigation">
          <NavLink to="/admin/users">Users</NavLink>
          <NavLink to="/admin/lessons">Lesson Management</NavLink>
          <NavLink to="/admin/assessments">Assessment Management</NavLink>
        </nav>
        <div className="admin-sidebar__account">
          <span>{user?.displayName ?? 'Administrator'}</span>
          <button type="button" onClick={() => setConfirmingLogout(true)}>
            Log out
          </button>
        </div>
      </aside>
      <details className="admin-mobile-nav" ref={mobileMenuRef}>
        <summary>Admin menu</summary>
        <nav aria-label="Admin navigation mobile">
          <NavLink to="/admin/users">Users</NavLink>
          <NavLink to="/admin/lessons">Lesson Management</NavLink>
          <NavLink to="/admin/assessments">Assessment Management</NavLink>
        </nav>
        <div className="admin-mobile-nav__account">
          <span>{user?.displayName ?? 'Administrator'}</span>
          <button
            type="button"
            onClick={() => {
              mobileMenuRef.current?.removeAttribute('open');
              setConfirmingLogout(true);
            }}
          >
            Log out
          </button>
        </div>
      </details>
      <main className="admin-content">
        <Outlet />
      </main>
      <ConfirmDialog
        open={confirmingLogout}
        title="Log out of the admin workspace?"
        confirmLabel="Log out"
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={() => void handleLogout()}
      >
        Your session will end. Saved administration changes remain available.
      </ConfirmDialog>
    </div>
  );
}
