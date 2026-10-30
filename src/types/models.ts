import { z } from 'zod';

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
  theme: z.enum(['light', 'dark', 'system']).default('dark'),
  readabilityScale: z.number().min(1).max(1.3).default(1),
  masterVolume: z.number().int().min(0).max(100),
  soundEffectsVolume: z.number().int().min(0).max(100),
  musicVolume: z.number().int().min(0).max(100),
  animationsEnabled: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});

export type StudentProfile = z.infer<typeof profileSchema>;
export type UserSettings = z.infer<typeof settingsSchema>;
export interface PublicUser {
  id: string;
  normalizedUsername: string;
  displayName: string;
  createdAt: number;
  lastLoginAt: number | null;
}
