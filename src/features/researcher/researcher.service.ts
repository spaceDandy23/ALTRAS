import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';

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
  username: z.string().regex(/^[a-z0-9_-]{3,24}$/),

  lessons_completed: z.coerce.number().int().nonnegative(),
  lessons_available: z.coerce.number().int().nonnegative(),
  latest_activity_at: z.string().nullable(),
  lesson_results: z.array(remoteLessonResultSchema),
});
const remoteLessonAssessmentResultSchema = z.object({
  participant_code: z.string().regex(/^ALT-[A-F0-9]{8}$/),
  username: z.string().regex(/^[a-z0-9_-]{3,24}$/),
  lesson_id: z.string().min(1),
  lesson_title: z.string().min(1),
  pre_test_status: assessmentStatusSchema,
  pre_test_score: z.coerce.number().int().min(0).max(100).nullable(),
  post_test_status: assessmentStatusSchema,
  post_test_score: z.coerce.number().int().min(0).max(100).nullable(),
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
  username: string;

  lessonsCompleted: number;
  lessonsAvailable: number;
  latestActivityAt: number | null;
  lessonResults: ResearcherLessonResult[];
}

export interface ResearcherLessonAssessmentResult {
  participantCode: string;
  username: string;
  lessonId: string;
  lessonTitle: string;
  preTestStatus: AssessmentProgress;
  preTestScore: number | null;
  postTestStatus: AssessmentProgress;
  postTestScore: number | null;
}



export interface ResearcherLessonSummary {
  lessonId: string;
  studentsStarted: number;
  studentsCompleted: number;
  completionRate: number | null;
  averageScore: number | null;
  averageAttempts: number | null;
}

export class ResearcherAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearcherAccessError';
  }
}

const missingBackendCodes = new Set(['PGRST202', '42883', '42P01', '42703', '42702', '42804']);

export function researcherResultsErrorMessage(code?: string): string {
  if (code === '42501') return 'Researcher access required.';
  if (code && missingBackendCodes.has(code)) {
    return 'The researcher results backend is not ready. Apply the latest Supabase migrations.';
  }
  return 'Unable to load researcher results.';
}

function timestamp(value: string | null): number | null {
  return value ? Date.parse(value) : null;
}

export function toResearcherParticipantResult(input: unknown): ResearcherParticipantResult {
  const record = remoteParticipantResultSchema.parse(input);
  return {
    participantCode: record.participant_code,
    username: record.username,

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



export function calculateLessonSummaries(
  participants: ResearcherParticipantResult[],
): ResearcherLessonSummary[] {
  const lessonIds = Array.from(
    new Set(
      participants.flatMap((participant) =>
        participant.lessonResults.map((lesson) => lesson.lessonId),
      ),
    ),
  ).sort();
  return lessonIds.map((lessonId) => {
    const results = participants
      .map((participant) =>
        participant.lessonResults.find((lesson) => lesson.lessonId === lessonId),
      )
      .filter((lesson): lesson is ResearcherLessonResult => Boolean(lesson));
    const started = results.filter((lesson) => lesson.attemptCount > 0);
    const completed = results.filter((lesson) => lesson.status === 'cleared');
    return {
      lessonId,
      studentsStarted: started.length,
      studentsCompleted: completed.length,
      completionRate: started.length === 0 ? null : (completed.length / started.length) * 100,
      averageScore: average(completed.map((lesson) => lesson.bestScore)),
      averageAttempts: average(started.map((lesson) => lesson.attemptCount)),
    };
  });
}

export async function isCurrentUserResearcher(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('is_researcher');
  if (error) throw new ResearcherAccessError('Unable to verify researcher access.');
  return data === true;
}

export async function getResearcherResults(): Promise<ResearcherParticipantResult[]> {
  const { data, error } = await getSupabaseClient().rpc('get_researcher_results');
  if (error) {
    throw new ResearcherAccessError(researcherResultsErrorMessage(error.code));
  }
  const parsed = z.array(remoteParticipantResultSchema).safeParse(data);
  if (!parsed.success) {
    throw new ResearcherAccessError(
      'The researcher results response does not match this ALTRAS version. Apply the latest Supabase migrations.',
    );
  }
  return parsed.data.map(toResearcherParticipantResult);
}

export async function getResearcherLessonAssessmentResults(): Promise<ResearcherLessonAssessmentResult[]> {
  const { data, error } = await getSupabaseClient().rpc('get_researcher_lesson_assessment_results');
  if (error) throw new ResearcherAccessError(researcherResultsErrorMessage(error.code));
  const parsed = z.array(remoteLessonAssessmentResultSchema).safeParse(data);
  if (!parsed.success)
    throw new ResearcherAccessError(
      'The lesson assessment response does not match this ALTRAS version. Apply the latest Supabase migrations.',
    );
  return parsed.data.map((row) => ({
    participantCode: row.participant_code,
    username: row.username,
    lessonId: row.lesson_id,
    lessonTitle: row.lesson_title,
    preTestStatus: row.pre_test_status,
    preTestScore: row.pre_test_score,
    postTestStatus: row.post_test_status,
    postTestScore: row.post_test_score,
  }));
}
