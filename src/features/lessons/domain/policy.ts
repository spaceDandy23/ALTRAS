export const SCORING_POLICY = {
  passingScore: 70,
  oneStarMinimum: 70,
  twoStarMinimum: 85,
  threeStarMinimum: 100,
  xpPerScorePoint: 1,
  xpPerStar: 10,
} as const;

export function calculateScore(correctAnswers: number, totalActivities: number): number {
  if (totalActivities <= 0) return 0;
  return Math.round((Math.max(0, correctAnswers) / totalActivities) * 100);
}

export function calculateStars(score: number): number {
  if (score >= SCORING_POLICY.threeStarMinimum) return 3;
  if (score >= SCORING_POLICY.twoStarMinimum) return 2;
  if (score >= SCORING_POLICY.oneStarMinimum) return 1;
  return 0;
}

export function isPassingScore(
  score: number,
  threshold: number = SCORING_POLICY.passingScore,
): boolean {
  return score >= threshold;
}

export function calculateLessonXp(bestScore: number, bestStars: number): number {
  return (
    Math.max(0, Math.min(100, bestScore)) * SCORING_POLICY.xpPerScorePoint +
    Math.max(0, Math.min(3, bestStars)) * SCORING_POLICY.xpPerStar
  );
}

export function calculateXpImprovement(
  previousScore: number,
  previousStars: number,
  nextScore: number,
  nextStars: number,
): number {
  return Math.max(
    0,
    calculateLessonXp(nextScore, nextStars) - calculateLessonXp(previousScore, previousStars),
  );
}
