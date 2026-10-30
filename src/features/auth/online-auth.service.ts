import type { User } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';
import type { PublicUser } from '@/types/models';
import {
  loginSchema,
  normalizeUsername,
  registrationSchema,
  type LoginInput,
  type RegistrationInput,
} from './auth.schemas';
import { AuthError } from './auth.errors';

const AUTH_DOMAIN = 'students.altras.invalid';

export function usernameToAuthEmail(username: string): string {
  return `${normalizeUsername(username)}@${AUTH_DOMAIN}`;
}

const profileIdentitySchema = z.object({
  username: z.string().trim().min(1),
  display_name: z.string().trim().min(2).max(40),
});

function publicUserFromIdentity(
  user: User,
  normalizedUsername: string,
  displayName: string,
): PublicUser {
  return {
    id: user.id,
    normalizedUsername,
    displayName,
    createdAt: Date.parse(user.created_at),
    lastLoginAt: user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : null,
  };
}

async function toPublicUser(user: User): Promise<PublicUser> {
  const normalizedUsername = String(user.user_metadata.username ?? '').trim();
  const displayName = String(user.user_metadata.display_name ?? '').trim();

  if (normalizedUsername && displayName) {
    return publicUserFromIdentity(user, normalizedUsername, displayName);
  }

  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', user.id)
    .single();
  const profile = error ? null : profileIdentitySchema.safeParse(data);

  if (!profile || !profile.success) {
    throw new AuthError('INVALID_DATA', 'This account is missing required profile information.');
  }

  return publicUserFromIdentity(user, profile.data.username, profile.data.display_name);
}

function mapAuthFailure(message: string, fallback: string): AuthError {
  const normalizedMessage = message.toLocaleLowerCase('en-US');

  if (
    normalizedMessage.includes('already registered') ||
    normalizedMessage.includes('already been registered') ||
    normalizedMessage.includes('duplicate')
  ) {
    return new AuthError('DUPLICATE_USERNAME', 'That username is already registered.');
  }

  if (normalizedMessage.includes('invalid login credentials')) {
    return new AuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.');
  }

  return new AuthError('INVALID_DATA', fallback);
}

function isInvalidCredentials(message: string): boolean {
  return message.toLocaleLowerCase('en-US').includes('invalid login credentials');
}

async function resolveManualLoginEmail(username: string, password: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('resolve_login_email', {
    p_username: username,
    p_password: password,
  });

  if (error || typeof data !== 'string' || !data) {
    throw new AuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.');
  }

  return data;
}

export async function registerOnlineUser(input: RegistrationInput): Promise<PublicUser> {
  const result = registrationSchema.safeParse(input);
  if (!result.success) {
    throw new AuthError('INVALID_DATA', result.error.issues[0]?.message ?? 'Check your details.');
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: usernameToAuthEmail(result.data.username),
    password: result.data.password,
    options: {
      data: {
        username: result.data.username,
        display_name: result.data.displayName,
      },
    },
  });

  if (error) {
    throw mapAuthFailure(error.message, 'Unable to create the online account.');
  }
  if (!data.user || !data.session) {
    throw new AuthError(
      'INVALID_DATA',
      'Account confirmation is enabled. Disable email confirmation in the Supabase project.',
    );
  }

  return toPublicUser(data.user);
}

export async function loginOnlineUser(input: LoginInput): Promise<PublicUser> {
  const result = loginSchema.safeParse(input);
  if (!result.success) {
    throw new AuthError('INVALID_DATA', result.error.issues[0]?.message ?? 'Check your details.');
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(result.data.username),
    password: result.data.password,
  });

  if (!error && data.user) return toPublicUser(data.user);

  if (!error) {
    throw new AuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.');
  }

  if (!isInvalidCredentials(error.message)) {
    throw mapAuthFailure(error.message, 'Unable to sign in to the online account.');
  }

  const email = await resolveManualLoginEmail(result.data.username, result.data.password);
  const fallback = await supabase.auth.signInWithPassword({
    email,
    password: result.data.password,
  });
  if (fallback.error || !fallback.data.user) {
    throw new AuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.');
  }
  return toPublicUser(fallback.data.user);
}

export async function restoreOnlineSession(): Promise<PublicUser | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw mapAuthFailure(error.message, 'Unable to restore the online session.');
  return data.session ? toPublicUser(data.session.user) : null;
}

export function subscribeToOnlineAuthChanges(
  listener: (user: PublicUser | null) => void,
): () => void {
  const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
    if (!session) {
      listener(null);
      return;
    }

    void toPublicUser(session.user).then(listener).catch(() => listener(null));
  });
  return () => data.subscription.unsubscribe();
}

export async function logoutOnlineUser(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw mapAuthFailure(error.message, 'Unable to sign out.');
}
