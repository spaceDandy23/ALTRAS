import { z } from 'zod';
import { getSupabaseClient, isSupabaseConfigured } from '@/services/supabase.client';
import { assertParticipantLearningAccess } from '@/stores/researcher-access.store';
import {
  assessmentAttemptSchema,
  assessmentKindSchema,
  assessmentQuestionSchema,
  type AssessmentAttempt,
  type AssessmentKind,
  type AssessmentQuestion,
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
  assessment_attempt_answers: z.array(remoteAnswerSchema).optional().default([]),
});

const attemptColumns = `
  id, user_id, assessment, status, started_at, submitted_at, score,
  completion_seconds, content_version, expected_question_count,
  assessment_attempt_answers (question_id, selected_choice_id, answered_at)
`;

export class AssessmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentError';
  }
}

function requireOnlineServices() {
  if (!isSupabaseConfigured) {
    throw new AssessmentError('Assessments require an internet connection.');
  }
  return getSupabaseClient();
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
  const { data, error } = await requireOnlineServices().rpc('get_assessment_questions', {
    p_assessment: kind,
  });
  if (error) throw new AssessmentError('Unable to load the assessment questions.');
  return z.array(remoteQuestionSchema).parse(data).map(toQuestion);
}

export async function getAssessmentAttempt(
  userId: string,
  kind: AssessmentKind,
): Promise<AssessmentAttempt | null> {
  const { data, error } = await requireOnlineServices()
    .from('assessment_attempts')
    .select(attemptColumns)
    .eq('user_id', userId)
    .eq('assessment', kind)
    .maybeSingle();
  if (error) throw new AssessmentError('Unable to restore this assessment.');
  return data ? toAssessmentAttempt(data) : null;
}

export async function startAssessment(
  userId: string,
  kind: AssessmentKind,
): Promise<AssessmentAttempt> {
  assertParticipantLearningAccess();
  const client = requireOnlineServices();
  const { error } = await client.rpc('start_assessment', { p_assessment: kind });
  if (error) throw new AssessmentError('Unable to start this assessment.');
  const attempt = await getAssessmentAttempt(userId, kind);
  if (!attempt) throw new AssessmentError('The assessment did not start correctly.');
  return attempt;
}

export async function submitAssessmentAnswer(
  attemptId: string,
  questionId: string,
  choiceId: string,
  currentAttempt: AssessmentAttempt,
): Promise<AssessmentAttempt> {
  assertParticipantLearningAccess();
  const { error } = await requireOnlineServices().rpc('submit_assessment_answer', {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_choice_id: choiceId,
  });
  if (error) throw new AssessmentError('Unable to save this answer. Please try again.');

  // The server has confirmed the insert, so avoid a second round trip just to
  // reconstruct state the client already has.
  const now = Date.now();
  const newAnswer = { questionId, selectedChoiceId: choiceId, answeredAt: now };
  const existingAnswerIndex = currentAttempt.answers.findIndex(
    (answer) => answer.questionId === questionId,
  );

  return {
    ...currentAttempt,
    answers:
      existingAnswerIndex >= 0
        ? [
            ...currentAttempt.answers.slice(0, existingAnswerIndex),
            newAnswer,
            ...currentAttempt.answers.slice(existingAnswerIndex + 1),
          ]
        : [...currentAttempt.answers, newAnswer],
  };
}

export async function completeAssessment(
  userId: string,
  kind: AssessmentKind,
  attemptId: string,
): Promise<AssessmentAttempt> {
  assertParticipantLearningAccess();
  const { error } = await requireOnlineServices().rpc('complete_assessment', {
    p_attempt_id: attemptId,
  });
  if (error) throw new AssessmentError('Answer every question before submitting the test.');
  const attempt = await getAssessmentAttempt(userId, kind);
  if (!attempt) throw new AssessmentError('Unable to load the submitted result.');
  return attempt;
}
