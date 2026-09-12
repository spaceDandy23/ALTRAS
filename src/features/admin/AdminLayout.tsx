import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AltrasLogo } from '@/components/brand/AltrasLogo';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuthStore } from '@/stores/auth.store';
import './lesson-management.css';

export function AdminLayout() {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <AltrasLogo />
        <nav aria-label="Admin navigation">
          <NavLink to="/admin/users">Users</NavLink>
          <NavLink to="/admin/lessons">Lesson Management</NavLink>
          <NavLink to="/">Home</NavLink>
          <button type="button" onClick={() => setConfirmingLogout(true)}>
            Log out
          </button>
        </nav>
      </header>
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
