import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from './content/packaged-content';
import { getLesson } from './content/content.service';
import {
  completeAttempt,
  consumeLessonAttemptLaunchMode,
  getAttempt,
  submitActivityAnswer,
} from './attempts/attempt.service';
import {
  createLessonDraft,
  getLessonDraft,
  markLessonDraftPendingCompletion,
  queueLessonAnswer,
  saveLessonDraft,
} from './attempts/lesson-draft.service';
import { db } from '@/db/database';
import type { LessonAttempt, SubmittedActivityAnswer } from '@/types/learning';
import { playSfx } from '@/services/audio/audio.manager';
import { ActiveLessonPage } from './ActiveLessonPage';

vi.mock('./content/content.service', () => ({ getLesson: vi.fn() }));
vi.mock('./attempts/attempt.service', () => ({
  completeAttempt: vi.fn(),
  consumeLessonAttemptLaunchMode: vi.fn(() => 'resume'),
  getAttempt: vi.fn(),
  recordAttemptActiveSeconds: vi.fn().mockResolvedValue(undefined),
  submitActivityAnswer: vi.fn(),
}));
vi.mock('@/services/audio/audio.manager', () => ({ playCompletion: vi.fn(), playSfx: vi.fn() }));

describe('active lesson loading failures', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await db.lessonDrafts.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it.each([
    ['first', 'Starting your lesson…'],
    ['retry', 'Starting a new attempt…'],
    ['resume', 'Restoring your attempt…'],
  ] as const)('shows lifecycle-specific copy for a %s launch', (mode, expected) => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    vi.mocked(consumeLessonAttemptLaunchMode).mockReturnValueOnce(mode);
    vi.mocked(getLesson).mockReturnValue(new Promise(() => undefined));
    vi.mocked(getAttempt).mockReturnValue(new Promise(() => undefined));
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('renders a recoverable error and retries restoration', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
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
    });
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Lesson attempt unavailable' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: lesson.activities[0].title }),
    ).toBeInTheDocument();
    expect(getAttempt).toHaveBeenCalledTimes(2);
  });

  it('restores a newly created retry attempt under Strict Mode without a draft conflict', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    vi.mocked(consumeLessonAttemptLaunchMode).mockReturnValueOnce('retry');
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue({
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
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
    });
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
          <Routes>
            <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', { name: lesson.activities[0].title })).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Lesson attempt unavailable' }),
    ).not.toBeInTheDocument();
  });

  it('persists an offline answer before allowing the student to continue', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    const activeAttempt: LessonAttempt = {
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'active' as const,
      startedAt: 1,
      lastUpdatedAt: 1,
      completedAt: null,
      abandonedAt: null,
      answers: [],
      finalScore: null,
      starCount: null,
      cleared: null,
      xpImprovement: 0,
    };
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(activeAttempt);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    const firstView = render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('radio', { name: 'sum' }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText(/Saved on this device · Waiting to sync/)).toBeVisible();
    expect(submitActivityAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: lesson.activities[1].title })).toBeVisible();
    await expect(getLessonDraft(userId, lesson.id, attemptId)).resolves.toMatchObject({
      currentActivityIndex: 1,
      pendingAnswers: [{ activityId: lesson.activities[0].id, answer: 'sum' }],
    });

    firstView.unmount();
    vi.mocked(getLesson).mockClear();
    vi.mocked(getAttempt).mockClear();
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: lesson.activities[1].title })).toBeVisible();
    expect(getLesson).not.toHaveBeenCalled();
    expect(getAttempt).not.toHaveBeenCalled();
  });

  it('does not show offline-save feedback while an online answer is being checked', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    const activeAttempt: LessonAttempt = {
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
      status: 'active' as const,
      startedAt: 1,
      lastUpdatedAt: 1,
      completedAt: null,
      abandonedAt: null,
      answers: [],
      finalScore: null,
      starCount: null,
      cleared: null,
      xpImprovement: 0,
    };
    let resolveSubmission!: (value: LessonAttempt) => void;
    const submission = new Promise<LessonAttempt>((resolve) => {
      resolveSubmission = resolve;
    });
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(activeAttempt);
    vi.mocked(submitActivityAnswer).mockReturnValue(submission);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('radio', { name: 'sum' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'sum' })).toBeDisabled());

    expect(screen.getByText('Saving…')).toBeVisible();
    expect(screen.queryByText('Saved on this device')).not.toBeInTheDocument();

    await act(async () => {
      resolveSubmission({
        ...activeAttempt,
        answers: [
          {
            activityId: lesson.activities[0].id,
            activityType: lesson.activities[0].type,
            answer: 'sum',
            isCorrect: true,
            submittedAt: 2,
          },
        ],
      });
      await submission;
    });

    expect(await screen.findByText('Correct')).toBeVisible();
    expect(playSfx).toHaveBeenCalledWith('correct');
  });

  it('does not flash the final activity result while an offline completion is syncing', async () => {
    const lesson = packagedContent.lessons[0];
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    const activeAttempt: LessonAttempt = {
      id: attemptId,
      userId,
      lessonId: lesson.id,
      contentVersion: lesson.contentVersion,
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
    };
    let localDraft = createLessonDraft(activeAttempt, lesson);
    for (const [index, activity] of lesson.activities.entries()) {
      localDraft = queueLessonAnswer(
        localDraft,
        activity.id,
        activity.type,
        activity.type === 'find-word'
          ? activity.correctChoiceId
          : activity.correctTokenSequence,
        index,
      );
    }
    localDraft = markLessonDraftPendingCompletion(localDraft);
    const syncedAnswers: SubmittedActivityAnswer[] = [];
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await saveLessonDraft(localDraft);
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(submitActivityAnswer).mockImplementation(
      async (_database, _attemptId, activityId, answer) => {
        const activity = lesson.activities.find((item) => item.id === activityId);
        if (!activity) throw new Error('Missing submitted activity fixture.');
        syncedAnswers.push({
          activityId,
          activityType: activity.type,
          answer,
          isCorrect: false,
          submittedAt: syncedAnswers.length + 1,
        });
        return { ...activeAttempt, answers: [...syncedAnswers] };
      },
    );
    vi.mocked(completeAttempt).mockReturnValue(new Promise(() => undefined));
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useContentStore.setState({ status: 'ready', error: null });
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Saved on this device')).toBeVisible();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event('online')));

    await waitFor(() => expect(completeAttempt).toHaveBeenCalledWith(db, attemptId));
    expect(submitActivityAnswer).toHaveBeenCalledTimes(lesson.activities.length);
    expect(screen.getByText('Saving…')).toBeVisible();
    expect(screen.queryByText('Correct')).not.toBeInTheDocument();
    expect(screen.queryByText(/Not quite/)).not.toBeInTheDocument();
    expect(
      document.querySelector('.choice-option--incorrect, .translation-builder--incorrect'),
    ).not.toBeInTheDocument();
    expect(playSfx).not.toHaveBeenCalled();
  });
});
