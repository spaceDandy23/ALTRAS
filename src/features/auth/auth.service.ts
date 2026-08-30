import type { AltrasDatabase } from '@/db/database';
import {
  CURRENT_PASSWORD_DERIVATION,
  constantTimeEqual,
  createSalt,
  derivePassword,
} from '@/services/crypto';
import {
  profileSchema,
  sessionSchema,
  settingsSchema,
  toPublicUser,
  userSchema,
  type LocalSession,
  type PublicUser,
} from '@/types/models';
import {
  loginSchema,
  registrationSchema,
  type LoginInput,
  type RegistrationInput,
} from './auth.schemas';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export class AuthError extends Error {
  constructor(
    public readonly code: 'DUPLICATE_USERNAME' | 'INVALID_CREDENTIALS' | 'INVALID_DATA',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function createSession(database: AltrasDatabase, userId: string): Promise<LocalSession> {
  const now = Date.now();
  const session = sessionSchema.parse({
    id: crypto.randomUUID(),
    userId,
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + SESSION_LIFETIME_MS,
  });

  await database.transaction('rw', database.sessions, async () => {
    await database.sessions.clear();
    await database.sessions.add(session);
  });
  return session;
}

export async function registerUser(
  database: AltrasDatabase,
  input: RegistrationInput,
): Promise<PublicUser> {
  const result = registrationSchema.safeParse(input);
  if (!result.success) {
    throw new AuthError('INVALID_DATA', result.error.issues[0]?.message ?? 'Check your details.');
  }

  const now = Date.now();
  const salt = createSalt();
  const passwordHash = await derivePassword(
    result.data.password,
    salt,
    CURRENT_PASSWORD_DERIVATION,
  );
  const userId = crypto.randomUUID();
  const user = userSchema.parse({
    id: userId,
    normalizedUsername: result.data.username,
    displayName: result.data.displayName,
    passwordHash,
    passwordSalt: salt,
    passwordDerivation: CURRENT_PASSWORD_DERIVATION,
    createdAt: now,
    lastLoginAt: now,
  });
  const profile = profileSchema.parse({
    id: crypto.randomUUID(),
    userId,
    displayName: result.data.displayName,
    createdAt: now,
    updatedAt: now,
  });
  const settings = settingsSchema.parse({
    id: crypto.randomUUID(),
    userId,
    theme: 'dark',
    readabilityScale: 1,
    masterVolume: 80,
    soundEffectsVolume: 80,
    musicVolume: 60,
    animationsEnabled: true,
    updatedAt: now,
  });

  try {
    await database.transaction(
      'rw',
      [database.users, database.profiles, database.settings],
      async () => {
        await database.users.add(user);
        await database.profiles.add(profile);
        await database.settings.add(settings);
      },
    );
  } catch (error) {
    if ((error as Error).name === 'ConstraintError') {
      throw new AuthError('DUPLICATE_USERNAME', 'That username already exists on this device.');
    }
    throw error;
  }

  await createSession(database, userId);
  return toPublicUser(user);
}

export async function loginUser(database: AltrasDatabase, input: LoginInput): Promise<PublicUser> {
  const result = loginSchema.safeParse(input);
  if (!result.success) {
    throw new AuthError('INVALID_DATA', result.error.issues[0]?.message ?? 'Check your details.');
  }

  const storedUser = await database.users.get({ normalizedUsername: result.data.username });
  if (!storedUser) {
    throw new AuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.');
  }
  const user = userSchema.parse(storedUser);
  const candidate = await derivePassword(
    result.data.password,
    user.passwordSalt,
    user.passwordDerivation,
  );
  if (!constantTimeEqual(candidate, user.passwordHash)) {
    throw new AuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.');
  }

  const lastLoginAt = Date.now();
  await database.users.update(user.id, { lastLoginAt });
  await createSession(database, user.id);
  return toPublicUser({ ...user, lastLoginAt });
}

export async function restoreSession(database: AltrasDatabase): Promise<PublicUser | null> {
  const storedSession = await database.sessions.orderBy('lastAccessedAt').last();
  if (!storedSession) return null;

  const parsedSession = sessionSchema.safeParse(storedSession);
  if (!parsedSession.success || parsedSession.data.expiresAt <= Date.now()) {
    await database.sessions.delete(storedSession.id);
    return null;
  }

  const storedUser = await database.users.get(parsedSession.data.userId);
  const parsedUser = userSchema.safeParse(storedUser);
  if (!parsedUser.success) {
    await database.sessions.delete(parsedSession.data.id);
    return null;
  }

  await database.sessions.update(parsedSession.data.id, { lastAccessedAt: Date.now() });
  return toPublicUser(parsedUser.data);
}

export async function logoutUser(database: AltrasDatabase): Promise<void> {
  await database.sessions.clear();
}
