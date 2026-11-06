import { describe, expect, it } from 'vitest';
import type { LessonProgress } from '@/types/learning';
import { resolveLessonDisplayStatus } from './lesson-display-status';

function progress(overrides: Partial<LessonProgress> = {}): LessonProgress {
  return {
    id: 'user:lesson-one',
    userId: '20000000-0000-4000-8000-000000000002',
    lessonId: 'lesson-one',
    status: 'available',
    bestScore: 0,
    bestStarCount: 0,
    attemptCount: 0,
    xpAwarded: 0,
    firstStartedAt: null,
    lastAttemptedAt: null,
    clearedAt: null,
    ...overrides,
  };
}

describe('lesson display status', () => {
  it('labels an untouched available lesson as not started', () => {
    expect(resolveLessonDisplayStatus(progress())).toBe('not-started');
  });

  it('labels an active unfinished attempt as in progress', () => {
    expect(resolveLessonDisplayStatus(progress(), true)).toBe('in-progress');
    expect(resolveLessonDisplayStatus(progress({ status: 'in-progress' }))).toBe('in-progress');
  });

  it('labels any uncleared completed-attempt history as needing retry', () => {
    expect(resolveLessonDisplayStatus(progress({ attemptCount: 1, bestScore: 40 }))).toBe(
      'needs-retry',
    );
    expect(resolveLessonDisplayStatus(progress({ attemptCount: 3, bestScore: 60 }))).toBe(
      'needs-retry',
    );
  });

  it('uses cleared progress as the passing state without requiring a perfect score', () => {
    expect(
      resolveLessonDisplayStatus(progress({ status: 'cleared', bestScore: 70, attemptCount: 1 })),
    ).toBe('cleared');
  });
});
