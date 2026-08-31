import { describe, expect, it } from 'vitest';
import {
  calculateResearcherSummary,
  toResearcherParticipantResult,
  type ResearcherParticipantResult,
} from './researcher.service';

const participant = (
  participantCode: string,
  preTestScore: number | null,
  postTestScore: number | null,
  lessonsCompleted = 0,
  lessonsAvailable = 2,
): ResearcherParticipantResult => ({
  participantCode,
  preTestStatus: preTestScore === null ? 'not_started' : 'completed',
  preTestScore,
  preTestCompletedAt: preTestScore === null ? null : 1,
  postTestStatus: postTestScore === null ? 'not_started' : 'completed',
  postTestScore,
  postTestCompletedAt: postTestScore === null ? null : 2,
  lessonsCompleted,
  lessonsAvailable,
  latestActivityAt: 3,
  lessonResults: [],
});

describe('researcher results mapping and summary', () => {
  it('calculates averages and score changes only for completed assessments', () => {
    const summary = calculateResearcherSummary([
      participant('ALT-8F21C4A1', 40, 70, 2),
      participant('ALT-8F21C4A2', 80, null, 1),
      participant('ALT-8F21C4A3', null, 90, 0),
    ]);

    expect(summary).toMatchObject({
      participantCount: 3,
      preTestCompletedCount: 2,
      postTestCompletedCount: 2,
      bothCompletedCount: 1,
      averagePreTestScore: 60,
      averagePostTestScore: 80,
      averageScoreChange: 30,
      allLessonsCompletedCount: 1,
    });
  });

  it('returns null averages for an empty dataset', () => {
    expect(calculateResearcherSummary([])).toMatchObject({
      participantCount: 0,
      averagePreTestScore: null,
      averagePostTestScore: null,
      averageScoreChange: null,
    });
  });

  it('maps only the anonymous fields returned by the researcher RPC', () => {
    const result = toResearcherParticipantResult({
      participant_code: 'ALT-8F21C4A1',
      pre_test_status: 'completed',
      pre_test_score: 75,
      pre_test_completed_at: '2026-08-31T10:00:00.000Z',
      post_test_status: 'not_started',
      post_test_score: null,
      post_test_completed_at: null,
      lessons_completed: 1,
      lessons_available: 2,
      latest_activity_at: '2026-08-31T10:00:00.000Z',
      lesson_results: [
        {
          lesson_id: 'lesson-1',
          status: 'cleared',
          best_score: 100,
          latest_score: 100,
          attempt_count: 1,
          completed_at: '2026-08-31T10:00:00.000Z',
          active_seconds: 42,
        },
      ],
      user_id: '00000000-0000-0000-0000-000000000000',
      email: 'student@example.test',
      display_name: 'Student Name',
      selected_choice_id: 'a',
    });

    expect(result).toMatchObject({
      participantCode: 'ALT-8F21C4A1',
      preTestScore: 75,
      lessonResults: [{ lessonId: 'lesson-1', bestScore: 100 }],
    });
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('displayName');
    expect(JSON.stringify(result)).not.toContain('00000000-0000-0000-0000-000000000000');
    expect(JSON.stringify(result)).not.toContain('student@example.test');
    expect(JSON.stringify(result)).not.toContain('Student Name');
    expect(JSON.stringify(result)).not.toContain('selected_choice_id');
  });
});
