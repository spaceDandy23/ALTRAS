import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserManagementPage } from './UserManagementPage';
const service = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  provisionAdminUser: vi.fn(),
  setAdminAccess: vi.fn(),
  setResearcherAccess: vi.fn(),
  setUserBanned: vi.fn(),
}));
vi.mock('./user-management.service', () => ({ ADMIN_USER_PAGE_SIZE: 20, ...service }));
const users = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'author',
    displayName: 'Admin Author',
    email: 'author@example.test',
    createdAt: '2026-09-12T00:00:00Z',
    lastSignInAt: '2026-09-12T01:00:00Z',
    banned: false,
    researcher: false,
    admin: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    username: 'learner',
    displayName: 'Student Learner',
    email: 'learner@example.test',
    createdAt: '2026-09-11T00:00:00Z',
    lastSignInAt: null,
    banned: true,
    researcher: true,
    admin: false,
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  service.listAdminUsers.mockResolvedValue({ users, page: 1, pageSize: 20, total: 22 });
  service.provisionAdminUser.mockResolvedValue('30000000-0000-4000-8000-000000000003');
  service.setAdminAccess.mockResolvedValue(undefined);
  service.setResearcherAccess.mockResolvedValue(undefined);
  service.setUserBanned.mockResolvedValue(undefined);
});
describe('User Management page', () => {
  it('shows safe account fields, statuses and server pagination', async () => {
    render(<UserManagementPage />);
    expect(await screen.findByText('Student Learner')).toBeInTheDocument();
    expect(screen.getByText('learner@example.test')).toBeInTheDocument();
    expect(screen.getByText('Banned')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(service.listAdminUsers).toHaveBeenLastCalledWith('', 2));
  });
  it('searches on submit without loading all users', async () => {
    render(<UserManagementPage />);
    await screen.findByText('Admin Author');
    fireEvent.change(screen.getByLabelText('Search users'), {
      target: { value: ' learner@example.test ' },
    });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() =>
      expect(service.listAdminUsers).toHaveBeenLastCalledWith('learner@example.test', 1),
    );
  });
  it('provisions with optional fields omitted and explicit access choices', async () => {
    const user = userEvent.setup();
    render(<UserManagementPage />);
    await screen.findByText('Admin Author');
    await user.type(screen.getByLabelText('Auth email'), 'new@example.test');
    await user.type(screen.getByLabelText('Temporary password'), 'Strongpass1');
    await user.click(screen.getByLabelText('Grant researcher access'));
    await user.click(screen.getByRole('button', { name: 'Provision account' }));
    await waitFor(() =>
      expect(service.provisionAdminUser).toHaveBeenCalledWith({
        email: 'new@example.test',
        password: 'Strongpass1',
        username: '',
        displayName: '',
        researcher: true,
        admin: false,
      }),
    );
    expect(await screen.findByText(/Profile and default settings/)).toBeInTheDocument();
  });
  it.each([
    ['Deactivate', 'Deactivate', service.setUserBanned, false, true],
    ['Reactivate', 'Reactivate', service.setUserBanned, true, false],
    ['Grant researcher', 'Grant access', service.setResearcherAccess, false, true],
    ['Revoke researcher', 'Revoke access', service.setResearcherAccess, true, false],
    ['Grant admin', 'Grant access', service.setAdminAccess, false, true],
    ['Revoke admin', 'Revoke access', service.setAdminAccess, true, false],
  ] as const)(
    'confirms %s before mutation',
    async (button, confirm, mutation, privileged, enabled) => {
      const target = {
        ...users[0],
        id: crypto.randomUUID(),
        username: button.toLowerCase().replace(' ', '-'),
        banned: button === 'Reactivate',
        researcher: privileged && button.includes('researcher'),
        admin: privileged && button.includes('admin'),
      };
      service.listAdminUsers.mockResolvedValue({
        users: [target],
        page: 1,
        pageSize: 20,
        total: 1,
      });
      const user = userEvent.setup();
      render(<UserManagementPage />);
      await user.click(await screen.findByRole('button', { name: button }));
      expect(mutation).not.toHaveBeenCalled();
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: confirm }),
      );
      await waitFor(() => expect(mutation).toHaveBeenCalledWith(target.id, enabled));
    },
  );
});
