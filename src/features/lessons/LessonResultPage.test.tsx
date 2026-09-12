import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { LessonResultPage } from './LessonResultPage';
import { getAttempt } from './attempts/attempt.service';
import { getLesson } from './content/content.service';
import { packagedContent } from './content/packaged-content';
import { getLessonHubData } from './progress/progress.service';
import { resolveLessonResultReaction } from '@/features/characters/lesson-result-reaction';
import { recordLessonUnlock, resetLessonUnlocks } from './progress/progress-transitions';

vi.mock('./attempts/attempt.service', () => ({
  getAttempt: vi.fn(),
  startOrResumeAttempt: vi.fn(),
}));
vi.mock('./content/content.service', () => ({ getLesson: vi.fn() }));
vi.mock('./progress/progress.service', () => ({
  getLessonHubData: vi.fn(),
}));
const audio = vi.hoisted(() => ({
  playCompletion: vi.fn(),
  playReward: vi.fn(),
  playSfx: vi.fn(),
}));
vi.mock('@/services/audio/audio.manager', () => audio);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('final lesson result actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
    resetLessonUnlocks();
  });

  it('keeps completion and reward audio silent until the final result is rendered', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000009';
    const attempt: LessonAttempt = {
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'completed',
      startedAt: 1,
      lastUpdatedAt: 2,
      completedAt: 2,
      abandonedAt: null,
      answers: [],
      finalScore: 100,
      starCount: 3,
      cleared: true,
      xpImprovement: 130,
    };
    const progress: LessonProgress = {
      id: `${userId}:${lesson.id}`,
      userId,
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
    const delayedHub = deferred<Awaited<ReturnType<typeof getLessonHubData>>>();
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(attempt);
    vi.mocked(getLessonHubData).mockReturnValue(delayedHub.promise);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'result_audio',
        displayName: 'Result Audio',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    audio.playReward.mockImplementationOnce(() => {
      expect(document.querySelector('.result-board')).toBeInTheDocument();
      expect(screen.queryByText('Loading your result…')).not.toBeInTheDocument();
    });

    const view = render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/result/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Loading your result…')).toBeInTheDocument();
    expect(audio.playCompletion).not.toHaveBeenCalled();
    expect(audio.playReward).not.toHaveBeenCalled();

    delayedHub.resolve({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [{ lesson, progress }],
    });
    expect(await screen.findByRole('heading', { name: 'Lesson complete' })).toBeVisible();
    expect(audio.playReward).toHaveBeenCalledOnce();
    expect(audio.playCompletion).not.toHaveBeenCalled();

    view.rerender(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/result/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Lesson complete' })).toBeVisible(),
    );
    expect(audio.playReward).toHaveBeenCalledOnce();
    expect(audio.playCompletion).not.toHaveBeenCalled();
  });

  it('shows the next lesson unlock from the same post-completion progress snapshot', async () => {
    const [lesson, nextLesson] = packagedContent.lessons;
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000010';
    const attempt: LessonAttempt = {
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'completed',
      startedAt: 1,
      lastUpdatedAt: 2,
      completedAt: 2,
      abandonedAt: null,
      answers: [],
      finalScore: 100,
      starCount: 3,
      cleared: true,
      xpImprovement: 130,
    };
    const currentProgress: LessonProgress = {
      id: `${userId}:${lesson.id}`,
      userId,
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
    const nextProgress: LessonProgress = {
      ...currentProgress,
      id: `${userId}:${nextLesson.id}`,
      lessonId: nextLesson.id,
      status: 'available',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    };
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(attempt);
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [
        { lesson, progress: currentProgress },
        { lesson: nextLesson, progress: nextProgress },
      ],
    });
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'unlock',
        displayName: 'Unlock',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    recordLessonUnlock(userId, lesson.id);

    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/result/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(`${nextLesson.title} is now unlocked.`)).toBeVisible();
    expect(screen.getByRole('link', { name: 'View next lesson' })).toHaveAttribute(
      'href',
      `/lessons/${nextLesson.id}`,
    );
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
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [{ lesson, progress }],
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
    expect(audio.playReward).toHaveBeenCalledOnce();
    expect(audio.playReward).toHaveBeenCalledWith(attempt.id);
    expect(audio.playCompletion).not.toHaveBeenCalled();
    expect(audio.playSfx).not.toHaveBeenCalledWith('reward');
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

  it('shows a recoverable result error and retries a failed load', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000005';
    const attemptId = '10000000-0000-4000-8000-000000000005';
    const attempt: LessonAttempt = {
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'completed',
      startedAt: 1,
      lastUpdatedAt: 2,
      completedAt: 2,
      abandonedAt: null,
      answers: [],
      finalScore: 0,
      starCount: 0,
      cleared: false,
      xpImprovement: 0,
    };
    const progress: LessonProgress = {
      id: `${userId}:${lesson.id}`,
      userId,
      lessonId: lesson.id,
      status: 'available',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 1,
      xpAwarded: 0,
      firstStartedAt: 1,
      lastAttemptedAt: 2,
      clearedAt: null,
    };
    vi.mocked(getLesson).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(attempt);
    vi.mocked(getLessonHubData).mockResolvedValue({
      section: packagedContent.sections[0],
      unit: packagedContent.units[0],
      entries: [{ lesson, progress }],
    });
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'result_retry',
        displayName: 'Result Retry',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/result/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Result unavailable' })).toBeInTheDocument();
    expect(audio.playCompletion).not.toHaveBeenCalled();
    expect(audio.playReward).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Try again' })).toBeInTheDocument();
    expect(audio.playCompletion).toHaveBeenCalledOnce();
    expect(audio.playReward).not.toHaveBeenCalled();
  });
});
