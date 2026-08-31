import { z } from 'zod';
import { getSupabaseClient, isSupabaseConfigured } from '@/services/supabase.client';

const assessmentStatusSchema = z.enum(['not_started', 'in_progress', 'completed']);

const remoteLessonResultSchema = z.object({
  lesson_id: z.string().min(1),
  status: z.enum(['locked', 'available', 'in-progress', 'cleared']),
  best_score: z.coerce.number().int().min(0).max(100),
  latest_score: z.coerce.number().int().min(0).max(100).nullable(),
  attempt_count: z.coerce.number().int().nonnegative(),
  completed_at: z.string().nullable(),
  active_seconds: z.coerce.number().int().nonnegative(),
});

const remoteParticipantResultSchema = z.object({
  participant_code: z.string().regex(/^ALT-[A-F0-9]{8}$/),
  pre_test_status: assessmentStatusSchema,
  pre_test_score: z.coerce.number().int().min(0).max(100).nullable(),
  pre_test_completed_at: z.string().nullable(),
  post_test_status: assessmentStatusSchema,
  post_test_score: z.coerce.number().int().min(0).max(100).nullable(),
  post_test_completed_at: z.string().nullable(),
  lessons_completed: z.coerce.number().int().nonnegative(),
  lessons_available: z.coerce.number().int().nonnegative(),
  latest_activity_at: z.string().nullable(),
  lesson_results: z.array(remoteLessonResultSchema),
});

export type AssessmentProgress = z.infer<typeof assessmentStatusSchema>;

export interface ResearcherLessonResult {
  lessonId: string;
  status: 'locked' | 'available' | 'in-progress' | 'cleared';
  bestScore: number;
  latestScore: number | null;
  attemptCount: number;
  completedAt: number | null;
  activeSeconds: number;
}

export interface ResearcherParticipantResult {
  participantCode: string;
  preTestStatus: AssessmentProgress;
  preTestScore: number | null;
  preTestCompletedAt: number | null;
  postTestStatus: AssessmentProgress;
  postTestScore: number | null;
  postTestCompletedAt: number | null;
  lessonsCompleted: number;
  lessonsAvailable: number;
  latestActivityAt: number | null;
  lessonResults: ResearcherLessonResult[];
}

export interface ResearcherSummary {
  participantCount: number;
  preTestCompletedCount: number;
  postTestCompletedCount: number;
  bothCompletedCount: number;
  averagePreTestScore: number | null;
  averagePostTestScore: number | null;
  averageScoreChange: number | null;
  allLessonsCompletedCount: number;
}

export class ResearcherAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearcherAccessError';
  }
}

function timestamp(value: string | null): number | null {
  return value ? Date.parse(value) : null;
}

export function toResearcherParticipantResult(input: unknown): ResearcherParticipantResult {
  const record = remoteParticipantResultSchema.parse(input);
  return {
    participantCode: record.participant_code,
    preTestStatus: record.pre_test_status,
    preTestScore: record.pre_test_score,
    preTestCompletedAt: timestamp(record.pre_test_completed_at),
    postTestStatus: record.post_test_status,
    postTestScore: record.post_test_score,
    postTestCompletedAt: timestamp(record.post_test_completed_at),
    lessonsCompleted: record.lessons_completed,
    lessonsAvailable: record.lessons_available,
    latestActivityAt: timestamp(record.latest_activity_at),
    lessonResults: record.lesson_results.map((lesson) => ({
      lessonId: lesson.lesson_id,
      status: lesson.status,
      bestScore: lesson.best_score,
      latestScore: lesson.latest_score,
      attemptCount: lesson.attempt_count,
      completedAt: timestamp(lesson.completed_at),
      activeSeconds: lesson.active_seconds,
    })),
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function calculateResearcherSummary(
  participants: ResearcherParticipantResult[],
): ResearcherSummary {
  const preTestScores = participants.flatMap((participant) =>
    participant.preTestScore === null ? [] : [participant.preTestScore],
  );
  const postTestScores = participants.flatMap((participant) =>
    participant.postTestScore === null ? [] : [participant.postTestScore],
  );
  const scoreChanges = participants.flatMap((participant) =>
    participant.preTestScore === null || participant.postTestScore === null
      ? []
      : [participant.postTestScore - participant.preTestScore],
  );

  return {
    participantCount: participants.length,
    preTestCompletedCount: preTestScores.length,
    postTestCompletedCount: postTestScores.length,
    bothCompletedCount: scoreChanges.length,
    averagePreTestScore: average(preTestScores),
    averagePostTestScore: average(postTestScores),
    averageScoreChange: average(scoreChanges),
    allLessonsCompletedCount: participants.filter(
      (participant) =>
        participant.lessonsAvailable > 0 &&
        participant.lessonsCompleted === participant.lessonsAvailable,
    ).length,
  };
}

export async function isCurrentUserResearcher(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await getSupabaseClient().rpc('is_researcher');
  if (error) throw new ResearcherAccessError('Unable to verify researcher access.');
  return data === true;
}

export async function getResearcherResults(): Promise<ResearcherParticipantResult[]> {
  if (!isSupabaseConfigured) {
    throw new ResearcherAccessError('Researcher results require the online database connection.');
  }

  const { data, error } = await getSupabaseClient().rpc('get_researcher_results');
  if (error) {
    throw new ResearcherAccessError(
      error.code === '42501' ? 'Researcher access required.' : 'Unable to load researcher results.',
    );
  }
  return z.array(remoteParticipantResultSchema).parse(data).map(toResearcherParticipantResult);
}
