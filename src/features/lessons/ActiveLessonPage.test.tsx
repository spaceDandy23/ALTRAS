import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { packagedContent } from './content/packaged-content';
import { activitySchema, type ChooseCorrectTranslationActivity } from './domain/content.schemas';
import { getLesson } from './content/content.service';
import {
  completeAttempt,
  advanceAttemptStage,
  consumeLessonAttemptLaunchMode,
  getAttempt,
  submitActivityAnswer,
} from './attempts/attempt.service';
import {
  createLessonDraft,
  discoverPendingLessonDrafts,
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
  advanceAttemptStage: vi.fn(),
  completeAttempt: vi.fn(),
  consumeLessonAttemptLaunchMode: vi.fn(() => 'resume'),
  getAttempt: vi.fn(),
  recordAttemptActiveSeconds: vi.fn().mockResolvedValue(undefined),
  submitActivityAnswer: vi.fn(),
}));
vi.mock('@/services/audio/audio.manager', () => ({ playCompletion: vi.fn(), playSfx: vi.fn() }));

describe('active lesson loading failures', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await db.lessonDrafts.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    useAuthStore.setState({ status: 'guest', user: null });
    useContentStore.setState({ status: 'idle', error: null });
  });

  it('renders and submits a Choose-the-Correct-Translation activity in the active lesson flow', async () => {
    const activity: ChooseCorrectTranslationActivity = (() => {
      const parsed = activitySchema.parse({
        id: 'active-translation',
        type: 'choose-correct-translation',
        title: 'Choose the correct expression',
        prompt: 'The sum of a number and five',
        choices: [
          { id: 'sum', label: 'n + 5' },
          { id: 'difference', label: 'n - 5' },
        ],
        correctChoiceId: 'sum',
        explanation: { title: 'Sum means addition', body: 'Add five to n.' },
      });
      if (parsed.type !== 'choose-correct-translation') throw new Error('Invalid test activity.');
      return parsed;
    })();
    const lesson = {
      ...structuredClone(packagedContent.lessons[0]),
      activities: [activity],
    };
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
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(activeAttempt);
    vi.mocked(submitActivityAnswer).mockResolvedValue({
      ...activeAttempt,
      answers: [
        {
          activityId: activity.id,
          activityType: activity.type,
          answer: 'sum',
          isCorrect: true,
          submittedAt: 2,
        },
      ],
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

    expect(await screen.findByText(activity.prompt)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'n + 5' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText('Correct')).toBeVisible();
    expect(submitActivityAnswer).toHaveBeenCalledWith(db, attemptId, activity.id, 'sum', expect.anything());
  });

  it('shows the server-released correct answer and authored multiline explanation after a wrong answer', async () => {
    const parsed = activitySchema.parse({
      id: 'wrong-answer-translation',
      type: 'choose-correct-translation',
      title: 'Choose the correct expression',
      prompt: 'The sum of a number and five',
      choices: [
        { id: 'sum', label: 'n + 5' },
        { id: 'difference', label: 'n - 5' },
      ],
      correctChoiceId: 'sum',
      explanation: { title: 'Check the operation', body: 'Step 1:\nAdd both sides' },
    });
    if (parsed.type !== 'choose-correct-translation') throw new Error('Invalid test activity.');
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    const lesson = {
      ...structuredClone(packagedContent.lessons[0]),
      activities: [{ ...parsed, correctChoiceId: undefined, explanation: undefined }],
    };
    const releasedLesson = { ...lesson, activities: [parsed] };
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
    vi.mocked(getLesson)
      .mockResolvedValueOnce(lesson)
      .mockResolvedValueOnce(releasedLesson);
    vi.mocked(getAttempt).mockResolvedValue(activeAttempt);
    vi.mocked(submitActivityAnswer).mockResolvedValue({
      ...activeAttempt,
      answers: [{
        activityId: parsed.id,
        activityType: parsed.type,
        answer: 'difference',
        isCorrect: false,
        submittedAt: 2,
      }],
    });
    useAuthStore.setState({ status: 'authenticated', user: {
      id: userId, normalizedUsername: 'student', displayName: 'Student', createdAt: 1, lastLoginAt: 1,
    } });
    useContentStore.setState({ status: 'ready', error: null });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}><Routes>
      <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
    </Routes></MemoryRouter>);

    await user.click(await screen.findByRole('radio', { name: 'n - 5' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));

    expect(await screen.findByText('Not quite')).toBeVisible();
    expect(document.querySelector('.answer-feedback__correct-answer')?.textContent).toBe(
      'Correct answer: n + 5',
    );
    expect(screen.getByRole('heading', { name: 'Check the operation' })).toBeVisible();
    const explanation = screen.getByText((_content, element) =>
      element?.classList.contains('answer-feedback__explanation') ?? false,
    );
    expect(explanation.textContent).toBe('Step 1:\nAdd both sides');
    expect(getLesson).toHaveBeenLastCalledWith(db, lesson.id, attemptId);
    expect(playSfx).toHaveBeenCalledWith('incorrect');
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

  it('routes a new lesson attempt to its required pre-test', async () => {
    const lesson = {
      ...structuredClone(packagedContent.lessons[0]),
      assessments: { preTest: 'pre-test' as const, postTest: 'post-test' as const },
    };
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
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
      flowStage: 'pre-test',
      currentChapterId: `chapter-${lesson.id}`,
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
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
          <Route
            path="/lessons/:lessonId/play/:attemptId/assessment/:kind"
            element={<p>Lesson pre-test</p>}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Lesson pre-test')).toBeInTheDocument();
  });

  it('advances once from teaching after checkpointing active time', async () => {
    const base = structuredClone(packagedContent.lessons[0]);
    const lesson = {
      ...base,
      chapters: [
        {
          id: 'chapter-foundations',
          title: 'Foundations',
          description: 'Read this before practicing.',
          displayOrder: 1,
          instructionalContent: base.instructionalContent.slice(0, 2),
          activities: base.activities.slice(0, 2),
        },
        {
          id: 'chapter-applications',
          title: 'Applications',
          displayOrder: 2,
          instructionalContent: base.instructionalContent.slice(1),
          activities: base.activities.slice(2),
        },
      ],
    };
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    const teachingAttempt: LessonAttempt = {
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
      flowStage: 'chapter-teaching',
      currentChapterId: 'chapter-foundations',
    };
    vi.mocked(getLesson).mockResolvedValue(lesson);
    vi.mocked(getAttempt).mockResolvedValue(teachingAttempt);
    const advancedAttempt: LessonAttempt = {
      ...teachingAttempt,
      flowStage: 'chapter-activity',
    };
    let resolveAdvance!: (attempt: LessonAttempt) => void;
    vi.mocked(advanceAttemptStage).mockReturnValue(
      new Promise((resolve) => {
        resolveAdvance = resolve;
      }),
    );
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
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    render(
      <MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}>
        <Routes>
          <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Foundations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Words can signal an operation' })).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Vocabulary' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: lesson.activities[0].title }),
    ).not.toBeInTheDocument();
    now.mockReturnValue(3_000);
    const startButton = screen.getByRole('button', { name: 'Start chapter activities' });
    act(() => {
      startButton.click();
      startButton.click();
    });
    await waitFor(() => expect(advanceAttemptStage).toHaveBeenCalledTimes(1));
    expect(advanceAttemptStage).toHaveBeenCalledWith(
      attemptId,
      'chapter-teaching',
      'chapter-foundations',
    );
    await act(async () => resolveAdvance(advancedAttempt));
    expect(await screen.findByRole('heading', { name: lesson.activities[0].title })).toBeVisible();
  });

  it('restores an older attempt at an empty teaching stage directly into activities', async () => {
    const base = structuredClone(packagedContent.lessons[0]);
    const chapterId = 'chapter-no-teaching';
    const lesson = { ...base, chapters: [{ id: chapterId, title: 'Practice', displayOrder: 1,
      instructionalContent: [], activities: base.activities }] };
    const userId = '20000000-0000-4000-8000-000000000002';
    const attemptId = '10000000-0000-4000-8000-000000000001';
    const attempt: LessonAttempt = {
      id: attemptId, userId, lessonId: lesson.id, contentVersion: lesson.contentVersion,
      status: 'active', startedAt: 1, lastUpdatedAt: 1, completedAt: null, abandonedAt: null,
      answers: [], finalScore: null, starCount: null, cleared: null, xpImprovement: 0,
      flowStage: 'chapter-teaching', currentChapterId: chapterId,
    };
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await saveLessonDraft(createLessonDraft(attempt, lesson));
    useAuthStore.setState({ status: 'authenticated', user: {
      id: userId, normalizedUsername: 'student', displayName: 'Student', createdAt: 1, lastLoginAt: 1,
    } });
    useContentStore.setState({ status: 'ready', error: null });
    render(<MemoryRouter initialEntries={[`/lessons/${lesson.id}/play/${attemptId}`]}><Routes>
      <Route path="/lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
    </Routes></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: base.activities[0].title })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start chapter activities' })).not.toBeInTheDocument();
    expect((await getLessonDraft(userId, lesson.id, attemptId))?.attempt.flowStage).toBe('chapter-activity');
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
    expect(screen.getByText(`1 / ${lesson.activities.length}`)).toBeVisible();
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
    expect(screen.getByText(`1 / ${lesson.activities.length}`)).toBeVisible();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText(/Saved on this device · Waiting to sync/)).toBeVisible();
    expect(submitActivityAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: lesson.activities[1].title })).toBeVisible();
    expect(screen.getByText(`2 / ${lesson.activities.length}`)).toBeVisible();
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
    expect(screen.getByText(`2 / ${lesson.activities.length}`)).toBeVisible();
    expect(getLesson).not.toHaveBeenCalled();
    expect(getAttempt).not.toHaveBeenCalled();
  });

  it('waits for the online answer acknowledgement before showing feedback', async () => {
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
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

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
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('leaves no pending work for global sync after completing a lesson online', async () => {
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
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let localDraft = createLessonDraft(activeAttempt, lesson);
    for (const [index, activity] of lesson.activities.entries()) {
      localDraft = queueLessonAnswer(
        localDraft,
        activity.id,
        activity.type,
        activity.type === 'organize-translate' ? activity.correctTokenSequence : activity.correctChoiceId,
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
    let finish!: (attempt: LessonAttempt) => void;
    vi.mocked(completeAttempt).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
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
    const view = render(
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
    now = 5_000;
    await act(async () =>
      finish({
        ...activeAttempt,
        answers: syncedAnswers,
        status: 'completed',
        finalScore: 0,
        starCount: 0,
        cleared: false,
        completedAt: 10,
      }),
    );
    view.unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(async () =>
      expect(await getLessonDraft(userId, lesson.id, attemptId)).toMatchObject({
        pendingCompletion: false,
        pendingActiveTimeSegments: [],
        attempt: { status: 'completed', finalScore: 0 },
      }),
    );
    await expect(discoverPendingLessonDrafts(userId)).resolves.toEqual({
      drafts: [],
      invalidDraftIds: [],
    });
  });
});
