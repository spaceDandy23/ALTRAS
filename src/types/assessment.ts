import { z } from 'zod';

export const assessmentKindSchema = z.enum(['pre-test', 'post-test']);

export const assessmentChoiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const assessmentQuestionSchema = z.object({
  id: z.string().min(1),
  assessment: assessmentKindSchema,
  displayOrder: z.number().int().positive(),
  prompt: z.string().min(1),
  choices: z.array(assessmentChoiceSchema).min(2),
  contentVersion: z.number().int().positive(),
  isPlaceholder: z.boolean(),
});

export const assessmentAnswerSchema = z.object({
  questionId: z.string().min(1),
  selectedChoiceId: z.string().min(1),
  answeredAt: z.number().int().nonnegative(),
});

export const assessmentAttemptSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  assessment: assessmentKindSchema,
  status: z.enum(['active', 'submitted']),
  startedAt: z.number().int().nonnegative(),
  submittedAt: z.number().int().nonnegative().nullable(),
  score: z.number().int().min(0).max(100).nullable(),
  completionSeconds: z.number().int().nonnegative().nullable(),
  contentVersion: z.number().int().positive(),
  expectedQuestionCount: z.number().int().positive(),
  answers: z.array(assessmentAnswerSchema),
  acceptedRevision: z.number().int().nonnegative().optional(),
  acceptedMutationId: z.string().uuid().nullable().optional(),
  submittedRevision: z.number().int().nonnegative().nullable().optional(),
});

export type AssessmentKind = z.infer<typeof assessmentKindSchema>;
export type AssessmentQuestion = z.infer<typeof assessmentQuestionSchema>;
export type AssessmentAnswer = z.infer<typeof assessmentAnswerSchema>;
export type AssessmentAttempt = z.infer<typeof assessmentAttemptSchema>;

export type AssessmentDraftSyncStatus = 'pending' | 'synced' | 'pending_submission';

export interface AssessmentDraft {
  id: string;
  userId: string;
  assessment: AssessmentKind;
  attemptId: string;
  startedAt: number;
  contentVersion: number;
  expectedQuestionCount: number;
  questions: AssessmentQuestion[];
  answers: AssessmentAnswer[];
  currentQuestionIndex: number;
  revision: number;
  syncedRevision: number;
  mutationId?: string;
  pendingSnapshot?: { revision: number; mutationId: string };
  updatedAt: number;
  syncStatus: AssessmentDraftSyncStatus;
}
