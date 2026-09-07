import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';
import { assertParticipantLearningAccess } from '@/stores/researcher-access.store';
import {
  assessmentAttemptSchema,
  assessmentKindSchema,
  assessmentQuestionSchema,
  type AssessmentAttempt,
  type AssessmentKind,
  type AssessmentQuestion,
  type AssessmentDraft,
} from '@/types/assessment';

const remoteQuestionSchema = z.object({
  id: z.string(),
  assessment: assessmentKindSchema,
  display_order: z.number().int(),
  prompt: z.string(),
  choices: z.array(z.object({ id: z.string(), label: z.string() })),
  content_version: z.number().int(),
  is_placeholder: z.boolean(),
});

const remoteAnswerSchema = z.object({
  question_id: z.string(),
  selected_choice_id: z.string(),
  answered_at: z.string(),
});

const remoteAttemptSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  assessment: assessmentKindSchema,
  status: z.enum(['active', 'submitted']),
  started_at: z.string(),
  submitted_at: z.string().nullable(),
  score: z.number().int().nullable(),
  completion_seconds: z.number().int().nullable(),
  content_version: z.number().int(),
  expected_question_count: z.number().int(),
  accepted_revision: z.number().int().nonnegative(),
  accepted_mutation_id: z.string().uuid().nullable(),
  submitted_revision: z.number().int().nonnegative().nullable(),
  assessment_attempt_answers: z.array(remoteAnswerSchema).optional().default([]),
});

const ASSESSMENT_REQUEST_TIMEOUT_MS = 15_000;

export class AssessmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentError';
  }
}

function requireOnlineServices() {
  return getSupabaseClient();
}

async function withAssessmentTimeout<T>(operation: PromiseLike<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new AssessmentError('The assessment request timed out.')),
          ASSESSMENT_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function toQuestion(input: unknown): AssessmentQuestion {
  const record = remoteQuestionSchema.parse(input);
  return assessmentQuestionSchema.parse({
    id: record.id,
    assessment: record.assessment,
    displayOrder: record.display_order,
    prompt: record.prompt,
    choices: record.choices,
    contentVersion: record.content_version,
    isPlaceholder: record.is_placeholder,
  });
}

export function toAssessmentAttempt(input: unknown): AssessmentAttempt {
  const record = remoteAttemptSchema.parse(input);
  return assessmentAttemptSchema.parse({
    id: record.id,
    userId: record.user_id,
    assessment: record.assessment,
    status: record.status,
    startedAt: Date.parse(record.started_at),
    submittedAt: record.submitted_at ? Date.parse(record.submitted_at) : null,
    score: record.score,
    completionSeconds: record.completion_seconds,
    contentVersion: record.content_version,
    expectedQuestionCount: record.expected_question_count,
    acceptedRevision: record.accepted_revision,
    acceptedMutationId: record.accepted_mutation_id,
    submittedRevision: record.submitted_revision,
    answers: record.assessment_attempt_answers
      .map((answer) => ({
        questionId: answer.question_id,
        selectedChoiceId: answer.selected_choice_id,
        answeredAt: Date.parse(answer.answered_at),
      }))
      .sort((left, right) => left.answeredAt - right.answeredAt),
  });
}

export async function getAssessmentQuestions(kind: AssessmentKind): Promise<AssessmentQuestion[]> {
  const { data, error } = await withAssessmentTimeout(
    requireOnlineServices().rpc('get_assessment_questions', { p_assessment: kind }),
  );
  if (error) throw new AssessmentError('Unable to load the assessment questions.');
  return z.array(remoteQuestionSchema).parse(data).map(toQuestion);
}

export async function getAssessmentAttempt(
  userId: string,
  kind: AssessmentKind,
): Promise<AssessmentAttempt | null> {
  const { data, error } = await withAssessmentTimeout(
    requireOnlineServices().rpc('get_assessment_attempt', { p_assessment: kind }),
  );
  if (error) throw new AssessmentError('Unable to restore this assessment.');
  const records = z.array(remoteAttemptSchema).parse(data ?? []);
  if (records.some((record) => record.user_id !== userId || record.assessment !== kind)) {
    throw new AssessmentError('The restored assessment belongs to another session.');
  }
  return records[0] ? toAssessmentAttempt(records[0]) : null;
}

export async function startAssessment(
  userId: string,
  kind: AssessmentKind,
): Promise<AssessmentAttempt> {
  assertParticipantLearningAccess();
  const client = requireOnlineServices();
  const { error } = await withAssessmentTimeout(
    client.rpc('start_assessment', { p_assessment: kind }),
  );
  if (error) throw new AssessmentError('Unable to start this assessment.');
  const attempt = await getAssessmentAttempt(userId, kind);
  if (!attempt) throw new AssessmentError('The assessment did not start correctly.');
  return attempt;
}

export async function completeAssessment(
  userId: string,
  kind: AssessmentKind,
  attemptId: string,
  revision: number,
): Promise<AssessmentAttempt> {
  assertParticipantLearningAccess();
  const { error } = await withAssessmentTimeout(
    requireOnlineServices().rpc('complete_assessment_revision', {
      p_attempt_id: attemptId,
      p_revision: revision,
    }),
  );
  if (error)
    throw new AssessmentError(
      'Submission is not yet confirmed. We will check the saved result before retrying.',
    );
  const attempt = await getAssessmentAttempt(userId, kind);
  if (!attempt) throw new AssessmentError('Unable to load the submitted result.');
  return attempt;
}

export class AssessmentConflictError extends AssessmentError {}

export async function syncAssessmentDraft(draft: AssessmentDraft): Promise<AssessmentAttempt> {
  assertParticipantLearningAccess();
  const { error } = await withAssessmentTimeout(
    requireOnlineServices().rpc('sync_assessment_draft', {
      p_attempt_id: draft.attemptId,
      p_base_revision: draft.syncedRevision,
      p_revision: draft.revision,
      p_mutation_id: draft.mutationId,
      p_answers: draft.answers.map((answer) => ({
        question_id: answer.questionId,
        selected_choice_id: answer.selectedChoiceId,
      })),
    }),
  );
  if (error?.code === '40001') {
    throw new AssessmentConflictError(
      'This test changed in another tab or device. Reload the saved test to review its answers. Your local draft has been kept.',
    );
  }
  if (error) throw new AssessmentError('Unable to sync the test. We will retry.');
  const result = await getAssessmentAttempt(draft.userId, draft.assessment);
  if (!result || result.id !== draft.attemptId)
    throw new AssessmentError('Unable to confirm the saved test.');
  return result;
}
