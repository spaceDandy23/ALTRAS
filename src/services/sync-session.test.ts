import { afterEach, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { captureSyncSession, observeSyncAuthIdentity } from './sync-session';

const user = {
  id: 'user-a',
  normalizedUsername: 'a',
  displayName: 'A',
  createdAt: 1,
  lastLoginAt: 1,
};
afterEach(() => useAuthStore.setState({ status: 'guest', user: null }));

it('invalidates the previous session immediately on auth identity change, before profile hydration', () => {
  useAuthStore.setState({ status: 'authenticated', user });
  const old = captureSyncSession(user.id);
  observeSyncAuthIdentity(user.id); // Same-account token refresh must not stop valid work.
  expect(old()).toBe(true);
  observeSyncAuthIdentity('user-b');
  expect(old()).toBe(false);
  expect(captureSyncSession(user.id)()).toBe(false);
  expect(captureSyncSession('user-b')()).toBe(false);
  useAuthStore.setState({ status: 'authenticated', user: { ...user, id: 'user-b' } });
  expect(captureSyncSession('user-b')()).toBe(true);
  expect(old()).toBe(false);
});

it('does not revive an old worker when the same user logs in again', () => {
  useAuthStore.setState({ status: 'authenticated', user });
  const old = captureSyncSession(user.id);
  useAuthStore.setState({ status: 'guest', user: null });
  useAuthStore.setState({ status: 'authenticated', user });
  expect(old()).toBe(false);
  expect(captureSyncSession(user.id)()).toBe(true);
});
