import { z } from 'zod';
import {
  activitySchema,
  instructionalContentBlockSchema,
  lessonMetadataSchema,
  sectionSchema,
  unitSchema,
} from '@/features/lessons/domain/content.schemas';

export const storedSectionSchema = sectionSchema;
export const storedUnitSchema = unitSchema;
export const storedLessonSchema = lessonMetadataSchema;

export const storedLessonItemSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    lessonId: z.string().min(1),
    displayOrder: z.number().int().nonnegative(),
    kind: z.literal('instruction'),
    contentVersion: z.number().int().positive(),
    payload: instructionalContentBlockSchema,
  }),
  z.object({
    id: z.string().min(1),
    lessonId: z.string().min(1),
    displayOrder: z.number().int().nonnegative(),
    kind: z.literal('activity'),
    contentVersion: z.number().int().positive(),
    payload: activitySchema,
  }),
]);

export const contentVersionRecordSchema = z.object({
  id: z.literal('packaged-content'),
  version: z.number().int().positive(),
  installedAt: z.number().int().nonnegative(),
});

export const lessonProgressSchema = z.object({
  id: z.string().min(1),
  userId: z.string().uuid(),
  lessonId: z.string().min(1),
  status: z.enum(['locked', 'available', 'in-progress', 'cleared']),
  bestScore: z.number().int().min(0).max(100),
  bestStarCount: z.number().int().min(0).max(3),
  attemptCount: z.number().int().nonnegative(),
  xpAwarded: z.number().int().nonnegative(),
  firstStartedAt: z.number().int().nonnegative().nullable(),
  lastAttemptedAt: z.number().int().nonnegative().nullable(),
  clearedAt: z.number().int().nonnegative().nullable(),
});

export const submittedActivityAnswerSchema = z.object({
  activityId: z.string().min(1),
  activityType: z.enum(['find-word', 'organize-translate']),
  answer: z.union([z.string(), z.array(z.string())]),
  isCorrect: z.boolean(),
  submittedAt: z.number().int().nonnegative(),
});

export const lessonAttemptSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  lessonId: z.string().min(1),
  contentVersion: z.number().int().positive(),
  status: z.enum(['active', 'completed', 'abandoned']),
  startedAt: z.number().int().nonnegative(),
  lastUpdatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
  abandonedAt: z.number().int().nonnegative().nullable(),
  answers: z.array(submittedActivityAnswerSchema),
  finalScore: z.number().int().min(0).max(100).nullable(),
  starCount: z.number().int().min(0).max(3).nullable(),
  cleared: z.boolean().nullable(),
  xpImprovement: z.number().int().nonnegative(),
});

export type StoredSection = z.infer<typeof storedSectionSchema>;
export type StoredUnit = z.infer<typeof storedUnitSchema>;
export type StoredLesson = z.infer<typeof storedLessonSchema>;
export type StoredLessonItem = z.infer<typeof storedLessonItemSchema>;
export type ContentVersionRecord = z.infer<typeof contentVersionRecordSchema>;
export type LessonProgress = z.infer<typeof lessonProgressSchema>;
export type SubmittedActivityAnswer = z.infer<typeof submittedActivityAnswerSchema>;
export type LessonAttempt = z.infer<typeof lessonAttemptSchema>;
