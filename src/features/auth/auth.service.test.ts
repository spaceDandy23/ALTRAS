import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { AuthError, loginUser, logoutUser, registerUser, restoreSession } from './auth.service';

const registration = {
  username: 'Nova_Student',
  displayName: 'Nova',
  password: 'Orbit123',
  confirmPassword: 'Orbit123',
};

describe('local authentication', () => {
  let database: AltrasDatabase;

  beforeEach(() => {
    database = new AltrasDatabase(`altras-auth-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await database.delete();
  });

  it('registers a student and creates related local records', async () => {
    const user = await registerUser(database, registration);

    expect(user.normalizedUsername).toBe('nova_student');
    expect(user.displayName).toBe('Nova');
    await expect(database.users.count()).resolves.toBe(1);
    await expect(database.profiles.where('userId').equals(user.id).count()).resolves.toBe(1);
    await expect(database.settings.where('userId').equals(user.id).count()).resolves.toBe(1);
    await expect(database.sessions.where('userId').equals(user.id).count()).resolves.toBe(1);
  });

  it('rejects duplicate usernames after normalization', async () => {
    await registerUser(database, registration);

    await expect(
      registerUser(database, {
        ...registration,
        username: '  NOVA_student  ',
        displayName: 'Another Nova',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_USERNAME' } satisfies Partial<AuthError>);
  });

  it('never stores the raw password', async () => {
    const user = await registerUser(database, registration);
    const stored = await database.users.get(user.id);

    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(registration.password);
    expect(stored?.passwordHash).not.toBe(registration.password);
    expect(stored?.passwordSalt).toBeTruthy();
    expect(stored?.passwordDerivation.hash).toBe('SHA-256');
  });

  it('logs in with the correct password and rejects an incorrect one', async () => {
    await registerUser(database, registration);
    await logoutUser(database);

    const user = await loginUser(database, {
      username: 'NOVA_STUDENT',
      password: registration.password,
    });
    expect(user.normalizedUsername).toBe('nova_student');

    await expect(
      loginUser(database, { username: registration.username, password: 'Wrong999' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' } satisfies Partial<AuthError>);
  });

  it('restores a valid session and clears it on logout', async () => {
    const registered = await registerUser(database, registration);

    await expect(restoreSession(database)).resolves.toMatchObject({ id: registered.id });
    await logoutUser(database);
    await expect(restoreSession(database)).resolves.toBeNull();
  });
});
