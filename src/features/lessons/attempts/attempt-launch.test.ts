import { describe, expect, it } from 'vitest';
import type { LessonAttempt } from '@/types/learning';
import { classifyLessonAttemptLaunch } from './attempt-launch';

const activeAttempt = {
  id: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000002',
  lessonId: 'lesson-operation-signals',
  contentVersion: 1,
  status: 'active',
  startedAt: 1,
  lastUpdatedAt: 1,
  completedAt: null,
  abandonedAt: null,
  answers: [],
  finalScore: null,
  starCount: null,
  cleared: null,
  xpImprovement: 0,
} satisfies LessonAttempt;

describe('lesson attempt launch classification', () => {
  it('classifies no active attempt and no history as a first attempt', () => {
    expect(classifyLessonAttemptLaunch(null, 0)).toBe('first');
  });

  it('classifies no active attempt with completed history as a retry', () => {
    expect(classifyLessonAttemptLaunch(null, 1)).toBe('retry');
  });

  it('classifies an unfinished attempt as a resume regardless of history', () => {
    expect(classifyLessonAttemptLaunch(activeAttempt, 0)).toBe('resume');
  });
});
