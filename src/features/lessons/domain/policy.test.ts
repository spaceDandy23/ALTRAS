import { describe, expect, it } from 'vitest';
import {
  calculateLessonXp,
  calculateScore,
  calculateStars,
  calculateXpImprovement,
  isPassingScore,
} from './policy';

describe('lesson scoring and XP policy', () => {
  it('calculates percentage scores', () => {
    expect(calculateScore(5, 6)).toBe(83);
    expect(calculateScore(6, 6)).toBe(100);
    expect(calculateScore(0, 0)).toBe(0);
  });

  it.each([
    [69, 0],
    [70, 1],
    [84, 1],
    [85, 2],
    [99, 2],
    [100, 3],
  ])('maps score %i to %i stars', (score, stars) => {
    expect(calculateStars(score)).toBe(stars);
  });

  it('uses the configured passing boundary', () => {
    expect(isPassingScore(69)).toBe(false);
    expect(isPassingScore(70)).toBe(true);
  });

  it('awards XP only for an improvement in best performance', () => {
    expect(calculateLessonXp(85, 2)).toBe(105);
    expect(calculateXpImprovement(85, 2, 85, 2)).toBe(0);
    expect(calculateXpImprovement(85, 2, 100, 3)).toBe(25);
    expect(calculateXpImprovement(100, 3, 85, 2)).toBe(0);
  });
});
