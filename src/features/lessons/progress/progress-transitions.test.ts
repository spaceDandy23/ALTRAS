import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeLessonUnlock,
  hasPendingLessonUnlock,
  recordLessonUnlock,
  resetLessonUnlocks,
} from './progress-transitions';

describe('lesson unlock transitions', () => {
  afterEach(resetLessonUnlocks);

  it('records and consumes a real unlock once', () => {
    recordLessonUnlock('student-one', 'lesson-one');

    expect(hasPendingLessonUnlock('student-one', 'lesson-one')).toBe(true);
    expect(consumeLessonUnlock('student-one', 'lesson-one')).toBe(true);
    expect(consumeLessonUnlock('student-one', 'lesson-one')).toBe(false);
  });

  it('does not leak an unlock between students or prerequisite lessons', () => {
    recordLessonUnlock('student-one', 'lesson-one');

    expect(consumeLessonUnlock('student-two', 'lesson-one')).toBe(false);
    expect(consumeLessonUnlock('student-one', 'lesson-two')).toBe(false);
    expect(hasPendingLessonUnlock('student-one', 'lesson-one')).toBe(true);
  });
});
