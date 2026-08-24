import { z } from 'zod';

export const passwordDerivationSchema = z.object({
  algorithm: z.literal('PBKDF2'),
  hash: z.literal('SHA-256'),
  iterations: z.number().int().positive(),
  keyLength: z.literal(256),
  version: z.literal(1),
});

export const userSchema = z.object({
  id: z.string().uuid(),
  normalizedUsername: z.string().min(3),
  displayName: z.string().min(2),
  passwordHash: z.string().min(1),
  passwordSalt: z.string().min(1),
  passwordDerivation: passwordDerivationSchema,
  createdAt: z.number().int().nonnegative(),
  lastLoginAt: z.number().int().nonnegative().nullable(),
});

export const profileSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().min(2),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const settingsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  masterVolume: z.number().int().min(0).max(100),
  soundEffectsVolume: z.number().int().min(0).max(100),
  musicVolume: z.number().int().min(0).max(100),
  animationsEnabled: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});

export const sessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.number().int().nonnegative(),
  lastAccessedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

export type PasswordDerivation = z.infer<typeof passwordDerivationSchema>;
export type LocalUser = z.infer<typeof userSchema>;
export type StudentProfile = z.infer<typeof profileSchema>;
export type UserSettings = z.infer<typeof settingsSchema>;
export type LocalSession = z.infer<typeof sessionSchema>;

export type PublicUser = Pick<
  LocalUser,
  'id' | 'normalizedUsername' | 'displayName' | 'createdAt' | 'lastLoginAt'
>;

export function toPublicUser(user: LocalUser): PublicUser {
  const { id, normalizedUsername, displayName, createdAt, lastLoginAt } = user;
  return { id, normalizedUsername, displayName, createdAt, lastLoginAt };
}
