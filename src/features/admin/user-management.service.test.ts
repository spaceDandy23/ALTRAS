import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listAdminUsers,
  provisionAdminUser,
  setAdminAccess,
  setResearcherAccess,
  setUserBanned,
} from './user-management.service';
const client = vi.hoisted(() => ({ rpc: vi.fn(), functions: { invoke: vi.fn() } }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => client }));
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'learner',
  displayName: 'Learner',
  email: 'learner@example.test',
  createdAt: '2026-09-12T00:00:00Z',
  lastSignInAt: null,
  banned: false,
  researcher: false,
  admin: false,
};
beforeEach(() => vi.clearAllMocks());
describe('admin user management service', () => {
  it('uses controlled server pagination and search', async () => {
    client.rpc.mockResolvedValue({
      data: { users: [user], page: 2, pageSize: 20, total: 22 },
      error: null,
    });
    await expect(listAdminUsers(' learner ', 2)).resolves.toMatchObject({
      total: 22,
      users: [user],
    });
    expect(client.rpc).toHaveBeenCalledWith('admin_list_users', {
      p_search: 'learner',
      p_page: 2,
      p_page_size: 20,
    });
  });
  it('provisions only through the trusted Edge Function and supports explicit access selections', async () => {
    client.functions.invoke.mockResolvedValue({
      data: { user: { id: user.id, email: user.email, createdAt: user.createdAt } },
      error: null,
    });
    await provisionAdminUser({
      email: ' learner@example.test ',
      password: 'Strongpass1',
      username: '',
      displayName: '',
      researcher: true,
      admin: false,
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'provision',
        email: user.email,
        password: 'Strongpass1',
        username: undefined,
        displayName: undefined,
        researcher: true,
        admin: false,
      },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('routes ban and privilege changes to their narrow server operations', async () => {
    client.functions.invoke.mockResolvedValue({
      data: { user: { id: user.id, banned: true } },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: true, error: null });
    await setUserBanned(user.id, true);
    await setResearcherAccess(user.id, true);
    await setAdminAccess(user.id, false);
    expect(client.functions.invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set-banned', userId: user.id, banned: true },
    });
    expect(client.rpc).toHaveBeenCalledWith('admin_set_researcher_access', {
      p_user_id: user.id,
      p_enabled: true,
    });
    expect(client.rpc).toHaveBeenCalledWith('admin_set_admin_access', {
      p_user_id: user.id,
      p_enabled: false,
    });
  });
  it('fails closed on server and response-contract errors', async () => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Admin access required.' } });
    await expect(listAdminUsers('', 1)).rejects.toThrow('Admin access required');
    client.functions.invoke.mockResolvedValueOnce({ data: { password: 'leak' }, error: null });
    await expect(
      provisionAdminUser({
        email: user.email,
        password: 'Strongpass1',
        researcher: false,
        admin: false,
      }),
    ).rejects.toThrow();
  });
});
