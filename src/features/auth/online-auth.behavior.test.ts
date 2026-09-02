import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { AuthError } from './auth.errors';
import {
  loginOnlineUser,
  logoutOnlineUser,
  registerOnlineUser,
  restoreOnlineSession,
} from './online-auth.service';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/services/supabase.client', () => ({
  getSupabaseClient: () => ({ auth: mocks }),
}));

const registration = {
  username: 'Nova_Student',
  displayName: 'Nova',
  password: 'Orbit123',
  confirmPassword: 'Orbit123',
};

const remoteUser = {
  id: '00000000-0000-4000-8000-000000000001',
  created_at: '2026-08-30T12:00:00.000Z',
  last_sign_in_at: '2026-08-31T12:00:00.000Z',
  user_metadata: { username: 'nova_student', display_name: 'Nova' },
} as unknown as User;

describe('Supabase authentication behavior', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('registers through Supabase and maps the authenticated user', async () => {
    mocks.signUp.mockResolvedValue({ data: { user: remoteUser, session: {} }, error: null });
    const user = await registerOnlineUser(registration);

    expect(user.normalizedUsername).toBe('nova_student');
    expect(user.displayName).toBe('Nova');
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'nova_student@students.altras.invalid' }),
    );
  });

  it('maps duplicate Supabase registration failures to a recoverable error', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    });

    await expect(registerOnlineUser(registration)).rejects.toMatchObject({
      code: 'DUPLICATE_USERNAME',
    } satisfies Partial<AuthError>);
  });

  it('logs in through Supabase and maps invalid credentials', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: remoteUser }, error: null });
    await expect(
      loginOnlineUser({ username: 'NOVA_STUDENT', password: registration.password }),
    ).resolves.toMatchObject({ id: remoteUser.id, normalizedUsername: 'nova_student' });

    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    await expect(
      loginOnlineUser({ username: registration.username, password: 'Wrong999' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' } satisfies Partial<AuthError>);
  });

  it('restores the Supabase session and returns null when none exists', async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: { user: remoteUser } },
      error: null,
    });
    await expect(restoreOnlineSession()).resolves.toMatchObject({ id: remoteUser.id });

    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(restoreOnlineSession()).resolves.toBeNull();
  });

  it('logs out through Supabase and exposes sign-out failures', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: null });
    await expect(logoutOnlineUser()).resolves.toBeUndefined();

    mocks.signOut.mockResolvedValueOnce({ error: { message: 'network unavailable' } });
    await expect(logoutOnlineUser()).rejects.toThrow('Unable to sign out.');
  });
});
