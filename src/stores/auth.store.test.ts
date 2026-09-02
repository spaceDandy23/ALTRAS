import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@/types/models';

const mocks = vi.hoisted(() => ({
  restoreOnlineSession: vi.fn(),
  loginOnlineUser: vi.fn(),
  logoutOnlineUser: vi.fn(),
  hydrate: vi.fn(),
  deactivate: vi.fn(),
}));

vi.mock('@/features/auth/online-auth.service', () => ({
  loginOnlineUser: mocks.loginOnlineUser,
  logoutOnlineUser: mocks.logoutOnlineUser,
  registerOnlineUser: vi.fn(),
  restoreOnlineSession: mocks.restoreOnlineSession,
}));
vi.mock('@/features/settings/visual-preferences.bootstrap', () => ({
  hydrateVisualPreferencesForUser: mocks.hydrate,
}));
vi.mock('@/features/settings/visual-preferences.cache', () => ({
  deactivateVisualPreferences: mocks.deactivate,
}));

import { useAuthStore } from './auth.store';

const firstUser: PublicUser = {
  id: '00000000-0000-4000-8000-000000000001',
  normalizedUsername: 'first_student',
  displayName: 'First Student',
  createdAt: 1,
  lastLoginAt: 1,
};
const secondUser: PublicUser = {
  ...firstUser,
  id: '00000000-0000-4000-8000-000000000002',
  normalizedUsername: 'second_student',
  displayName: 'Second Student',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('authenticated visual bootstrap', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'idle', user: null });
    mocks.restoreOnlineSession.mockReset();
    mocks.loginOnlineUser.mockReset();
    mocks.logoutOnlineUser.mockReset();
    mocks.hydrate.mockReset();
    mocks.deactivate.mockReset();
  });

  afterEach(() => document.documentElement.style.removeProperty('--readability-scale'));

  it('applies cached Large/Largest settings before authenticated routes become ready', async () => {
    const hydration = deferred();
    mocks.restoreOnlineSession.mockResolvedValue(firstUser);
    mocks.hydrate.mockImplementation(() => {
      document.documentElement.style.setProperty('--readability-scale', '1.3');
      return hydration.promise;
    });

    const initialization = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledWith(firstUser.id));

    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
    expect(useAuthStore.getState()).toMatchObject({ status: 'loading', user: null });

    hydration.resolve();
    await initialization;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user: firstUser });
  });

  it('switches to the new account preferences before exposing that account', async () => {
    const hydration = deferred();
    useAuthStore.setState({ status: 'guest', user: null });
    document.documentElement.style.setProperty('--readability-scale', '1.3');
    mocks.loginOnlineUser.mockResolvedValue(secondUser);
    mocks.hydrate.mockImplementation((userId: string) => {
      expect(userId).toBe(secondUser.id);
      document.documentElement.style.setProperty('--readability-scale', '1');
      return hydration.promise;
    });

    const login = useAuthStore
      .getState()
      .login({ username: 'second_student', password: 'Pass1234' });
    await vi.waitFor(() => expect(mocks.hydrate).toHaveBeenCalledWith(secondUser.id));

    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1');
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null });

    hydration.resolve();
    await login;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user: secondUser });
  });

  it('logs out through Supabase and clears the active preference identity', async () => {
    useAuthStore.setState({ status: 'authenticated', user: firstUser });
    mocks.logoutOnlineUser.mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    expect(mocks.logoutOnlineUser).toHaveBeenCalledOnce();
    expect(mocks.deactivate).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null });
  });
});
