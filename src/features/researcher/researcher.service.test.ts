import { describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => client }));
import {
  calculateLessonSummaries,
  getResearcherLessonAssessmentResults,
  getResearcherResults,
  researcherResultsErrorMessage,
  toResearcherParticipantResult,
  type ResearcherParticipantResult,
} from './researcher.service';

const participant = (participantCode: string, lessonsCompleted = 0, lessonsAvailable = 2): ResearcherParticipantResult => ({
  participantCode,
  username: `student-${participantCode.slice(-2)}`,
  lessonsCompleted,
  lessonsAvailable,
  latestActivityAt: 3,
  lessonResults: [],
});

describe('researcher lesson results mapping', () => {
  it('loads per-lesson assessment results', async () => {
    client.rpc.mockResolvedValueOnce({
      error: null,
      data: [{
        participant_code: 'ALT-8F21C4A1', username: 'student-one', lesson_id: 'lesson-one',
        lesson_title: 'Lesson One', pre_test_status: 'completed', pre_test_score: 60,
        post_test_status: 'completed', post_test_score: 80,
      }],
    });
    await expect(getResearcherLessonAssessmentResults()).resolves.toEqual([
      expect.objectContaining({ lessonId: 'lesson-one', lessonTitle: 'Lesson One', preTestScore: 60, postTestScore: 80 }),
    ]);
    expect(client.rpc).toHaveBeenCalledWith('get_researcher_lesson_assessment_results');
  });

  it('loads participant lesson progress without requiring standalone scores', async () => {
    client.rpc.mockResolvedValueOnce({
      error: null,
      data: [{
        participant_code: 'ALT-8F21C4A1', username: 'username123', lessons_completed: 1,
        lessons_available: 2, latest_activity_at: '2026-08-31T10:00:00.000Z',
        lesson_results: [], pre_test_score: 100, post_test_score: 100,
      }],
    });
    await expect(getResearcherResults()).resolves.toEqual([
      expect.objectContaining({ participantCode: 'ALT-8F21C4A1', lessonsCompleted: 1 }),
    ]);
    expect(client.rpc).toHaveBeenCalledWith('get_researcher_results');
  });

  it('calculates lesson completion, score, and attempt summaries', () => {
    const first = participant('ALT-8F21C4A1');
    const second = participant('ALT-8F21C4A2');
    first.lessonResults = [{
      lessonId: 'lesson-1', status: 'cleared', bestScore: 90, latestScore: 90,
      attemptCount: 2, completedAt: 3, activeSeconds: 60,
    }];
    second.lessonResults = [{
      lessonId: 'lesson-1', status: 'in-progress', bestScore: 40, latestScore: 40,
      attemptCount: 1, completedAt: null, activeSeconds: 30,
    }];
    expect(calculateLessonSummaries([first, second])).toEqual([{
      lessonId: 'lesson-1', studentsStarted: 2, studentsCompleted: 1,
      completionRate: 50, averageScore: 90, averageAttempts: 1.5,
    }]);
  });

  it('maps only approved participant and lesson progress fields', () => {
    const result = toResearcherParticipantResult({
      participant_code: 'ALT-8F21C4A1', username: 'username123', lessons_completed: 1,
      lessons_available: 2, latest_activity_at: '2026-08-31T10:00:00.000Z', lesson_results: [],
      user_id: '00000000-0000-0000-0000-000000000000', email: 'student@example.test',
      display_name: 'Student Name', pre_test_score: 100,
    });
    expect(result).toEqual(expect.objectContaining({ participantCode: 'ALT-8F21C4A1', username: 'username123' }));
    expect(result).not.toHaveProperty('preTestScore');
    expect(result).not.toHaveProperty('userId');
    expect(JSON.stringify(result)).not.toContain('student@example.test');
    expect(JSON.stringify(result)).not.toContain('Student Name');
  });

  it('explains a missing or outdated researcher backend without exposing database details', () => {
    expect(researcherResultsErrorMessage('PGRST202')).toBe('The researcher results backend is not ready. Apply the latest Supabase migrations.');
    expect(researcherResultsErrorMessage('42501')).toBe('Researcher access required.');
    expect(researcherResultsErrorMessage('XX000')).toBe('Unable to load researcher results.');
  });
});