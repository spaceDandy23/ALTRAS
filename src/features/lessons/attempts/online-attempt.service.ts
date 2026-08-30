import { z } from 'zod';
import type { AltrasDatabase } from '@/db/database';
import { getSupabaseClient } from '@/services/supabase.client';
import {
  lessonAttemptSchema,
  submittedActivityAnswerSchema,
  type LessonAttempt,
} from '@/types/learning';
import { getLesson, getAllLessons } from '../content/content.service';
import { evaluateActivity, type ActivityAnswer } from '../domain/evaluation';
import { getOnlineLessonProgress } from '../progress/online-progress.service';
import { AttemptError } from './attempt.errors';

const remoteAnswerSchema = z.object({
  activity_id: z.string(),
  activity_type: z.enum(['find-word', 'organize-translate']),
  submitted_answer: z.union([z.string(), z.array(z.string())]),
  is_correct: z.boolean(),
  submitted_at: z.string(),
});

const remoteAttemptSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  lesson_id: z.string(),
  content_version: z.number().int(),
  status: z.enum(['active', 'completed', 'abandoned']),
  started_at: z.string(),
  last_updated_at: z.string(),
  completed_at: z.string().nullable(),
  abandoned_at: z.string().nullable(),
  final_score: z.number().int().nullable(),
  star_count: z.number().int().nullable(),
  cleared: z.boolean().nullable(),
  xp_improvement: z.number().int(),
  attempt_answers: z.array(remoteAnswerSchema).optional().default([]),
});

const attemptColumns = `
  id, user_id, lesson_id, content_version, status, started_at, last_updated_at,
  completed_at, abandoned_at, final_score, star_count, cleared, xp_improvement,
  attempt_answers (activity_id, activity_type, submitted_answer, is_correct, submitted_at)
`;

function time(value: string | null): number | null {
  return value ? Date.parse(value) : null;
}

export function toLessonAttempt(input: unknown): LessonAttempt {
  const record = remoteAttemptSchema.parse(input);
  return lessonAttemptSchema.parse({
    id: record.id,
    userId: record.user_id,
    lessonId: record.lesson_id,
    contentVersion: record.content_version,
    status: record.status,
    startedAt: time(record.started_at),
    lastUpdatedAt: time(record.last_updated_at),
    completedAt: time(record.completed_at),
    abandonedAt: time(record.abandoned_at),
    answers: record.attempt_answers
      .map((answer) =>
        submittedActivityAnswerSchema.parse({
          activityId: answer.activity_id,
          activityType: answer.activity_type,
          answer: answer.submitted_answer,
          isCorrect: answer.is_correct,
          submittedAt: Date.parse(answer.submitted_at),
        }),
      )
      .sort((left, right) => left.submittedAt - right.submittedAt),
    finalScore: record.final_score,
    starCount: record.star_count,
    cleared: record.cleared,
    xpImprovement: record.xp_improvement,
  });
}

async function readAttempt(attemptId: string): Promise<LessonAttempt> {
  const { data, error } = await getSupabaseClient()
    .from('lesson_attempts')
    .select(attemptColumns)
    .eq('id', attemptId)
    .single();
  if (error) throw new AttemptError('Unable to load this online attempt.');
  return toLessonAttempt(data);
}

export async function getOnlineActiveAttempt(
  userId: string,
  lessonId: string,
): Promise<LessonAttempt | null> {
  const { data, error } = await getSupabaseClient()
    .from('lesson_attempts')
    .select(attemptColumns)
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new AttemptError('Unable to check for an online attempt.');
  return data ? toLessonAttempt(data) : null;
}

async function createOnlineAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  const lesson = await getLesson(database, lessonId);
  const id = crypto.randomUUID();
  const { error } = await getSupabaseClient().from('lesson_attempts').insert({
    id,
    user_id: userId,
    lesson_id: lessonId,
    content_version: lesson.contentVersion,
    expected_activity_count: lesson.activities.length,
    passing_threshold: lesson.passingThreshold,
    status: 'active',
  });
  if (error) {
    const existing = await getOnlineActiveAttempt(userId, lessonId);
    if (existing) return existing;
    throw new AttemptError('Unable to start this online attempt.');
  }

  const now = new Date().toISOString();
  const progress = await getOnlineLessonProgress(database, userId, lessonId);
  const { error: progressError } = await getSupabaseClient()
    .from('lesson_progress')
    .update({
      status: progress.status === 'cleared' ? 'cleared' : 'in-progress',
      first_started_at: progress.firstStartedAt
        ? new Date(progress.firstStartedAt).toISOString()
        : now,
    })
    .eq('user_id', userId)
    .eq('lesson_id', lessonId);
  if (progressError) throw new AttemptError('The attempt started, but progress could not update.');
  return readAttempt(id);
}

export async function startOrResumeOnlineAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  const lesson = await getLesson(database, lessonId);
  if (lesson.contentStatus !== 'playable') throw new AttemptError('This lesson is a preview.');
  const progress = await getOnlineLessonProgress(database, userId, lessonId);
  if (progress.status === 'locked') throw new AttemptError('Clear the prerequisite lesson first.');
  return (
    (await getOnlineActiveAttempt(userId, lessonId)) ??
    createOnlineAttempt(database, userId, lessonId)
  );
}

export async function restartOnlineAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  const progress = await getOnlineLessonProgress(database, userId, lessonId);
  if (progress.status === 'locked') throw new AttemptError('Clear the prerequisite lesson first.');
  const active = await getOnlineActiveAttempt(userId, lessonId);
  if (active) {
    const { error } = await getSupabaseClient().rpc('abandon_lesson_attempt', {
      p_attempt_id: active.id,
    });
    if (error) throw new AttemptError('Unable to restart this online attempt.');
  }
  return createOnlineAttempt(database, userId, lessonId);
}

export async function submitOnlineActivityAnswer(
  database: AltrasDatabase,
  attemptId: string,
  activityId: string,
  answer: ActivityAnswer,
): Promise<LessonAttempt> {
  const attempt = await readAttempt(attemptId);
  if (attempt.status !== 'active') throw new AttemptError('This attempt is already closed.');
  if (attempt.answers.some((item) => item.activityId === activityId)) return attempt;
  const lesson = await getLesson(database, attempt.lessonId);
  const activity = lesson.activities.find((item) => item.id === activityId);
  if (!activity) throw new AttemptError('This activity is not part of the lesson.');

  const { error } = await getSupabaseClient()
    .from('attempt_answers')
    .insert({
      attempt_id: attemptId,
      activity_id: activityId,
      activity_type: activity.type,
      submitted_answer: answer,
      is_correct: evaluateActivity(activity, answer),
    });
  if (error && error.code !== '23505') throw new AttemptError('Unable to save this answer online.');
  return readAttempt(attemptId);
}

export async function completeOnlineAttempt(
  database: AltrasDatabase,
  attemptId: string,
): Promise<LessonAttempt> {
  const attempt = await readAttempt(attemptId);
  if (attempt.status === 'completed') return attempt;
  const lesson = await getLesson(database, attempt.lessonId);
  if (attempt.answers.length !== lesson.activities.length) {
    throw new AttemptError('Complete every activity before finishing the lesson.');
  }
  const lessons = await getAllLessons(database);
  const followUps = lessons
    .filter((candidate) => candidate.prerequisiteLessonId === lesson.id)
    .map((candidate) => candidate.id);
  const { error } = await getSupabaseClient().rpc('complete_lesson_attempt', {
    p_attempt_id: attemptId,
    p_follow_up_lesson_ids: followUps,
  });
  if (error) throw new AttemptError('Unable to finish and score this lesson online.');
  return readAttempt(attemptId);
}

export async function getOnlineAttempt(userId: string, attemptId: string): Promise<LessonAttempt> {
  const attempt = await readAttempt(attemptId);
  if (attempt.userId !== userId) throw new AttemptError('This attempt belongs to another account.');
  return attempt;
}

export async function recordOnlineActiveSeconds(attemptId: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const { error } = await getSupabaseClient().rpc('add_attempt_active_seconds', {
    p_attempt_id: attemptId,
    p_seconds: Math.min(3600, Math.floor(seconds)),
  });
  if (error) throw new AttemptError('Unable to save active lesson time.');
}
