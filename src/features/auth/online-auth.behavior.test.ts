import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { captureSyncSession, setSyncIdentity } from '@/services/sync-session';
import { AuthError } from './auth.errors';
import {
  loginOnlineUser,
  logoutOnlineUser,
  registerOnlineUser,
  restoreOnlineSession,
  subscribeToOnlineAuthChanges,
} from './online-auth.service';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  invoke: vi.fn(),
  setSession: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock('@/services/supabase.client', () => ({
  getSupabaseClient: () => ({ auth: mocks, functions: { invoke: mocks.invoke }, from: mocks.from }),
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

const manualRemoteUser = {
  ...remoteUser,
  user_metadata: { username: 'researchertest', display_name: 'researchertest' },
} as unknown as User;

const metadataFreeManualUser = {
  ...remoteUser,
  user_metadata: { email_verified: true },
} as unknown as User;

describe('Supabase authentication behavior', () => {
  beforeEach(() => {
    setSyncIdentity(null);
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ single: mocks.single });
  });

  it.each(['logout', 'switch'] as const)(
    'ignores old profile hydration after %s and stops its sync identity immediately',
    async (action) => {
      let notify!: (event: string, session: { user: User } | null) => void;
      mocks.onAuthStateChange.mockImplementation((callback) => {
        notify = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });
      let resolve!: (value: {
        data: { username: string; display_name: string };
        error: null;
      }) => void;
      mocks.single.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const listener = vi.fn();
      const stop = subscribeToOnlineAuthChanges(listener);
      setSyncIdentity(remoteUser.id);
      const previousSync = captureSyncSession(remoteUser.id);
      notify('SIGNED_IN', { user: metadataFreeManualUser });
      const next = { ...remoteUser, id: '00000000-0000-4000-8000-000000000099' };
      notify(
        action === 'logout' ? 'SIGNED_OUT' : 'SIGNED_IN',
        action === 'logout' ? null : { user: next },
      );
      expect(previousSync()).toBe(false);
      expect(captureSyncSession(next.id)()).toBe(false); // Profile/auth bootstrap has not confirmed it.
      await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
      resolve({ data: { username: 'old_user', display_name: 'Old User' }, error: null });
      await Promise.resolve();
      await Promise.resolve();
      expect(listener).toHaveBeenCalledOnce();
      if (action === 'logout') expect(listener).toHaveBeenCalledWith(null);
      else expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: next.id }));
      stop();
    },
  );

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
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { message: 'Unauthorized' } });
    await expect(
      loginOnlineUser({ username: registration.username, password: 'Wrong999' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' } satisfies Partial<AuthError>);
  });

  it('uses the rate-limited login function only after the synthetic login is rejected', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    mocks.invoke.mockResolvedValue({
      data: { accessToken: 'access-token', refreshToken: 'refresh-token' },
      error: null,
    });
    mocks.setSession.mockResolvedValue({ data: { user: manualRemoteUser }, error: null });

    await expect(
      loginOnlineUser({ username: 'researchertest', password: registration.password }),
    ).resolves.toMatchObject({ normalizedUsername: 'researchertest' });

    expect(mocks.invoke).toHaveBeenCalledWith('username-login', {
      body: { username: 'researchertest', password: registration.password },
    });
    expect(mocks.setSession).toHaveBeenCalledWith({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
  });

  it('maps a manually provisioned user from the authenticated user profile when Auth metadata is absent', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    mocks.invoke.mockResolvedValue({
      data: { accessToken: 'access-token', refreshToken: 'refresh-token' },
      error: null,
    });
    mocks.setSession.mockResolvedValue({ data: { user: metadataFreeManualUser }, error: null });
    mocks.single.mockResolvedValue({
      data: { username: 'testresearcher', display_name: 'testresearcher' },
      error: null,
    });

    await expect(
      loginOnlineUser({ username: 'testresearcher', password: registration.password }),
    ).resolves.toMatchObject({
      id: remoteUser.id,
      normalizedUsername: 'testresearcher',
      displayName: 'testresearcher',
    });

    expect(mocks.from).toHaveBeenCalledWith('profiles');
    expect(mocks.select).toHaveBeenCalledWith('username, display_name');
    expect(mocks.eq).toHaveBeenCalledWith('user_id', remoteUser.id);
  });

  it('keeps the required-profile error for a signed-in account without a usable own profile', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: metadataFreeManualUser },
      error: null,
    });
    mocks.single.mockResolvedValue({ data: null, error: { message: 'No rows found' } });

    await expect(
      loginOnlineUser({ username: 'testresearcher', password: registration.password }),
    ).rejects.toMatchObject({
      code: 'INVALID_DATA',
      message: 'This account is missing required profile information.',
    } satisfies Partial<AuthError>);
  });

  it.each(['unknown_user', 'researchertest'])(
    'keeps an invalid credential generic when username resolution returns no verified identity for %s',
    async (username) => {
      mocks.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      });
      mocks.invoke.mockResolvedValue({ data: null, error: { message: 'Unauthorized' } });

      await expect(loginOnlineUser({ username, password: 'Wrong999' })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Username or password is incorrect.',
      } satisfies Partial<AuthError>);
      expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
    },
  );

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
