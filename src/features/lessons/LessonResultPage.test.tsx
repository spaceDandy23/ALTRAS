import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { LessonResultPage } from './LessonResultPage';
import { getAttempt } from './attempts/attempt.service';
import { getLesson } from './content/content.service';
import { packagedContent } from './content/packaged-content';
import { getLessonHubData, getLessonProgress } from './progress/progress.service';
import { resolveLessonResultReaction } from '@/features/characters/lesson-result-reaction';

vi.mock('./attempts/attempt.service', () => ({
  getAttempt: vi.fn(),
  startOrResumeAttempt: vi.fn(),
}));
vi.mock('./content/content.service', () => ({ getLesson: vi.fn() }));
vi.mock('./progress/progress.service', () => ({
  getLessonHubData: vi.fn(),
  getLessonProgress: vi.fn(),
}));

describe('final lesson result actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it('does not offer a nonexistent next lesson after Order Matters', async () => {
    const lesson = packagedContent.lessons.find(
      (candidate) => candidate.id === 'lesson-order-matters',
    );
    if (!lesson) throw new Error('Missing Order Matters fixture.');
    const attempt: LessonAttempt = {
      id: '10000000-0000-4000-8000-000000000001',
      userId: '20000000-0000-4000-8000-000000000002',
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'completed',
      startedAt: 1,
      lastUpdatedAt: 2,
      completedAt: 2,
      abandonedAt: null,
      answers: lesson.activities.map((activity, index) => ({
        activityId: activity.id,
        activityType: activity.type,
        answer:
          activity.type === 'find-word' ? activity.correctChoiceId : activity.correctTokenSequence,
        isCorrect: true,
        submittedAt: index + 1,
      })),
      finalScore: 100,
      starCount: 3,
      cleared: true,
      xpImprovement: 130,
    };
    const progress: LessonProgress = {
      id: `${attempt.userId}:${lesson.id}`,
      userId: attempt.userId,
      lessonId: lesson.id,
      status: 'cleared',
      bestScore: 100,
      bestStarCount: 3,
      attemptCount: 1,
      xpAwarded: 130,
      firstStartedAt: 1,
      lastAttemptedAt: 2,
      clearedAt: 2,
    };

    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(attempt);
    vi.mocked(getLessonProgress).mockResolvedValue(progress);
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [],
    });
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: attempt.userId,
        normalizedUsername: 'final_solver',
        displayName: 'Final Solver',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/result/${attempt.id}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Lesson complete' })).toBeVisible(),
    );
    expect(screen.queryByRole('link', { name: 'View next lesson' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review lesson' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lessons' })).toHaveAttribute('href', '/lessons');
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'celebrating',
    );
  });

  it('maps passed and failed results to distinct non-scoring character reactions', () => {
    expect(resolveLessonResultReaction(true)).toEqual({
      state: 'celebrating',
      dialogueEvent: 'lesson-passed',
    });
    expect(resolveLessonResultReaction(false)).toEqual({
      state: 'encouraging',
      dialogueEvent: 'lesson-not-passed',
    });
  });
});
