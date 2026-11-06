import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { db } from '@/db/database';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import {
  createLessonDraft,
  getLessonDraft,
  saveLessonDraft,
} from '@/features/lessons/attempts/lesson-draft.service';
import type { AssessmentAttempt, AssessmentDraft, AssessmentQuestion } from '@/types/assessment';
import { AssessmentPage } from './AssessmentPage.async';
import {
  flushPendingLessonAttempt,
  queueAttemptStageTransition,
} from '@/features/lessons/attempts/attempt.service';
import {
  createOfflineAssessmentDraft,
  createAssessmentDraft,
  getAssessmentDraft,
  markDraftPendingSubmission,
  saveAssessmentDraft,
  updateDraftAnswer,
} from './assessment-draft.service';
import {
  completeAssessment,
  getAssessmentAttempt,
  getAssessmentQuestions,
  startAssessment,
  syncAssessmentDraft,
} from './assessment.service';
import { flushPendingAssessmentDraft } from './assessment-sync.service';

const audio = vi.hoisted(() => ({
  cancelPendingResultSfx: vi.fn(),
  playCompletion: vi.fn(),
  playReward: vi.fn(),
  playSfx: vi.fn(),
}));
vi.mock('./assessment.service', () => ({
  completeAssessment: vi.fn(),
  getAssessmentAttempt: vi.fn(),
  getAssessmentQuestions: vi.fn(),
  startAssessment: vi.fn(),
  syncAssessmentDraft: vi.fn(),
}));
vi.mock('@/services/audio/audio.manager', () => audio);
vi.mock('@/features/lessons/attempts/attempt.service', () => ({
  flushPendingLessonAttempt: vi.fn(),
  queueAttemptStageTransition: vi.fn(),
}));
vi.mock('./assessment-sync.service', () => ({ flushPendingAssessmentDraft: vi.fn() }));
const userId = '20000000-0000-4000-8000-000000000002';
const questions: AssessmentQuestion[] = [
  {
    id: 'q1',
    assessment: 'pre-test',
    displayOrder: 1,
    prompt: 'Which phrase represents addition?',
    choices: [
      { id: 'a', label: 'The sum of two values' },
      { id: 'b', label: 'The quotient of two values' },
    ],
    contentVersion: 1,
    isPlaceholder: false,
  },
];
const twoQuestions = [
  ...questions,
  { ...questions[0], id: 'q2', displayOrder: 2, prompt: 'Which phrase represents division?' },
];
function attempt(): AssessmentAttempt {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    userId,
    assessment: 'pre-test',
    status: 'active',
    startedAt: 1,
    submittedAt: null,
    score: null,
    completionSeconds: null,
    contentVersion: 1,
    expectedQuestionCount: 1,
    answers: [],
    acceptedRevision: 0,
    acceptedMutationId: null,
    submittedRevision: null,
  };
}
function submittedAttempt(score = 80): AssessmentAttempt {
  return {
    ...attempt(),
    status: 'submitted',
    submittedAt: 2,
    score,
    completionSeconds: 60,
    acceptedRevision: 1,
    acceptedMutationId: '30000000-0000-4000-8000-000000000003',
    submittedRevision: 1,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let server: AssessmentAttempt | null;
function accept(snapshot: AssessmentDraft) {
  server = {
    ...attempt(),
    id: snapshot.attemptId,
    assessment: snapshot.assessment,
    lessonId: snapshot.lessonId,
    lessonAttemptId: snapshot.lessonAttemptId,
    expectedQuestionCount: snapshot.expectedQuestionCount,
    answers: snapshot.answers,
    acceptedRevision: snapshot.revision,
    acceptedMutationId: snapshot.mutationId,
  };
  return server;
}
function renderAssessment(kind: 'pre-test' | 'post-test' = 'pre-test') {
  return render(
    <MemoryRouter initialEntries={[`/assessments/${kind}`]}>
      <Routes>
        <Route path="/assessments/:kind" element={<AssessmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
function renderLessonAssessment(kind: 'pre-test' | 'post-test' = 'pre-test') {
  const lessonId = 'lesson-operation-signals';
  const lessonAttemptId = '40000000-0000-4000-8000-000000000004';
  return render(
    <MemoryRouter
      initialEntries={[`/lessons/${lessonId}/play/${lessonAttemptId}/assessment/${kind}`]}
    >
      <Routes>
        <Route
          path="/lessons/:lessonId/play/:attemptId/assessment/:kind"
          element={<AssessmentPage />}
        />
        <Route path="/lessons/:lessonId/play/:attemptId" element={<p>Lesson player resumed</p>} />
        <Route path="/lessons/:lessonId" element={<p>Lesson overview</p>} />
        <Route path="/lessons/:lessonId/result/:attemptId" element={<p>Official lesson result</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function cacheLessonPreTest(snapshot = questions) {
  const lesson = { ...packagedContent.lessons[0], assessments: { preTest: 'pre-test' as const } };
  await saveLessonDraft(
    createLessonDraft(
      {
        id: '40000000-0000-4000-8000-000000000004',
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
        currentChapterId: null,
        preAssessmentVersion: 1,
      },
      lesson,
      0,
      { 'pre-test': snapshot },
    ),
  );
}
beforeEach(() => {
  server = attempt();
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
  vi.mocked(getAssessmentQuestions).mockResolvedValue(questions);
  vi.mocked(getAssessmentAttempt).mockImplementation(async () => server);
  vi.mocked(startAssessment).mockImplementation(async () => {
    server = attempt();
    return server;
  });
  vi.mocked(syncAssessmentDraft).mockImplementation(async (snapshot) => accept(snapshot));
  vi.mocked(completeAssessment).mockImplementation(async (_user, _kind, _id, revision) => {
    server = {
      ...server!,
      status: 'submitted',
      score: 100,
      submittedAt: 2,
      completionSeconds: 60,
      submittedRevision: revision,
    };
    return server;
  });
  vi.mocked(queueAttemptStageTransition).mockResolvedValue({} as never);
  vi.mocked(flushPendingLessonAttempt).mockResolvedValue(undefined);
  vi.mocked(flushPendingAssessmentDraft).mockResolvedValue(undefined);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  useAuthStore.setState({ status: 'guest', user: null });
  await db.assessmentDrafts.clear();
  await db.lessonDrafts.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('assessment UX and bootstrap', () => {
  it.each(['pre-test', 'post-test'] as const)(
    'shows readable choice markers without exposing internal IDs in the %s',
    async (kind) => {
      const ids = ['choice-11aa1111-1111-4111-8111-111111111111', 'choice-22bb2222-2222-4222-8222-222222222222'];
      const question = {
        ...questions[0],
        assessment: kind,
        choices: questions[0].choices.map((choice, index) => ({ ...choice, id: ids[index] })),
      };
      server = { ...attempt(), assessment: kind };
      vi.mocked(getAssessmentQuestions).mockResolvedValue([question]);
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      renderAssessment(kind);

      const choice = await screen.findByRole('radio', { name: 'The sum of two values' });
      await userEvent.setup().click(choice);
      expect(choice).toHaveAttribute('aria-checked', 'true');
      expect(choice).toHaveTextContent('A');
      for (const id of ids) expect(document.body.textContent?.toLowerCase()).not.toContain(id);
      expect(await screen.findByText('Saved on this device.')).toBeVisible();
      expect(screen.queryByRole('button', { name: /retry sync/i })).not.toBeInTheDocument();
    },
  );
  it.each(['pre-test', 'post-test'] as const)(
    'shows no sync banner after an online %s answer syncs successfully',
    async (kind) => {
      server = { ...attempt(), assessment: kind };
      vi.mocked(getAssessmentQuestions).mockResolvedValue(
        questions.map((question) => ({ ...question, assessment: kind })),
      );
      const user = userEvent.setup();
      renderAssessment(kind);

      await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
      await waitFor(async () => {
        expect(await getAssessmentDraft(userId, kind)).toMatchObject({ syncStatus: 'synced' });
      });
      expect(screen.queryByText(/Saved on this device|Synced to your account/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry sync/i })).not.toBeInTheDocument();
    },
  );
  it.each(['pre-test', 'post-test'] as const)(
    'clears the offline %s save note when connectivity returns',
    async (kind) => {
      const lessonId = packagedContent.lessons[0].id;
      const lessonAttemptId = '40000000-0000-4000-8000-000000000004';
      const kindQuestions = questions.map((question) => ({ ...question, assessment: kind }));
      const local = updateDraftAnswer(
        createOfflineAssessmentDraft(userId, kind, lessonId, lessonAttemptId, kindQuestions),
        'q1',
        'a',
      );
      await saveAssessmentDraft(local);
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      renderLessonAssessment(kind);

      expect(await screen.findByText('Saved on this device.')).toBeVisible();
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      act(() => window.dispatchEvent(new Event('online')));

      await waitFor(() =>
        expect(screen.queryByText('Saved on this device.')).not.toBeInTheDocument(),
      );
    },
  );
  it('finishes a cached pre-test offline, restores it, and continues into Chapter 1 without a request', async () => {
    await cacheLessonPreTest(twoQuestions);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    const first = renderLessonAssessment();
    await user.click(await screen.findByRole('button', { name: 'Start pre-test' }));
    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    await screen.findByText('Question 2 of 2');
    await user.click(screen.getByRole('radio', { name: 'The quotient of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    expect(await screen.findByRole('button', { name: 'Continue Lesson' })).toBeEnabled();
    expect(startAssessment).not.toHaveBeenCalled();
    expect(getAssessmentQuestions).not.toHaveBeenCalled();
    expect(getAssessmentAttempt).not.toHaveBeenCalled();
    expect(completeAssessment).not.toHaveBeenCalled();
    first.unmount();

    renderLessonAssessment();
    await user.click(await screen.findByRole('button', { name: 'Continue Lesson' }));
    expect(await screen.findByText('Lesson player resumed')).toBeVisible();
    const local = await getAssessmentDraft(
      userId,
      'pre-test',
      db,
      '40000000-0000-4000-8000-000000000004',
    );
    expect(local).toMatchObject({ syncStatus: 'pending_submission', currentQuestionIndex: 1 });
    expect(local?.answers).toHaveLength(2);
    const lesson = await getLessonDraft(
      userId,
      'lesson-operation-signals',
      '40000000-0000-4000-8000-000000000004',
    );
    expect(lesson?.attempt.flowStage).toBe('chapter-teaching');
    expect(lesson?.pendingStageTransitions).toHaveLength(1);
    expect(lesson?.attempt.finalScore).toBeNull();
  });

  it('does not wait for a stalled start/session request to answer and finish a cached pre-test', async () => {
    await cacheLessonPreTest(twoQuestions);
    vi.mocked(startAssessment).mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderLessonAssessment();
    await user.click(await screen.findByRole('button', { name: 'Start pre-test' }));
    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    await screen.findByText('Question 2 of 2');
    await user.click(screen.getByRole('radio', { name: 'The quotient of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    await user.click(await screen.findByRole('button', { name: 'Continue Lesson' }));
    expect(await screen.findByText('Lesson player resumed')).toBeVisible();
    expect(completeAssessment).not.toHaveBeenCalled();
  });

  it('keeps the pre-test editable if its local submission cannot be saved', async () => {
    await cacheLessonPreTest();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    renderLessonAssessment();
    await user.click(await screen.findByRole('button', { name: 'Start pre-test' }));
    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await waitFor(async () =>
      expect(
        (await getAssessmentDraft(userId, 'pre-test', db, '40000000-0000-4000-8000-000000000004'))
          ?.answers,
      ).toHaveLength(1),
    );
    vi.spyOn(db.lessonDrafts, 'put').mockRejectedValue(new Error('Local storage unavailable'));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    expect(await screen.findByText('Local storage unavailable')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue Lesson' })).not.toBeInTheDocument();
    expect(
      (await getAssessmentDraft(userId, 'pre-test', db, '40000000-0000-4000-8000-000000000004'))
        ?.syncStatus,
    ).not.toBe('pending_submission');
  });

  it('opens a fresh lesson pre-test when no assessment attempt exists yet', async () => {
    server = null;
    renderLessonAssessment();

    expect(await screen.findByRole('heading', { name: 'Check what you know' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start pre-test' })).toBeEnabled();
    expect(getAssessmentAttempt).toHaveBeenCalledWith(userId, 'pre-test', {
      lessonId: 'lesson-operation-signals',
      lessonAttemptId: '40000000-0000-4000-8000-000000000004',
    });
    expect(screen.queryByText('Unable to load the assessment result. Please retry.')).not.toBeInTheDocument();
  });
  it('uses cached lesson questions when the scoped question lookup returns no rows', async () => {
    await cacheLessonPreTest();
    const cached = await getLessonDraft(userId, 'lesson-operation-signals', '40000000-0000-4000-8000-000000000004');
    expect(cached).not.toBeNull();
    await saveLessonDraft({ ...cached!, attempt: { ...cached!.attempt, flowStage: 'chapter-teaching' }, revision: cached!.revision + 1 });
    server = null;
    vi.mocked(getAssessmentQuestions).mockResolvedValueOnce([]);
    renderLessonAssessment();

    expect(await screen.findByRole('heading', { name: 'Check what you know' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start pre-test' })).toBeEnabled();
  });
  it('offers a return link when uncached assessment content is unavailable', async () => {
    server = null;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.mocked(getAssessmentQuestions).mockRejectedValueOnce(new Error('network unavailable'));
    vi.mocked(getAssessmentAttempt).mockResolvedValueOnce(null);
    renderLessonAssessment();

    await screen.findByRole('heading', { name: 'We couldn’t load this test' });
    expect(screen.getByRole('link', { name: 'Return to lesson' })).toHaveAttribute(
      'href',
      '/lessons/lesson-operation-signals',
    );
    expect(screen.getByRole('button', { name: 'Try again' }).parentElement).toHaveClass('result-actions');
  });

  it('continues a completed lesson pre-test into the owning lesson attempt', async () => {
    server = {
      ...submittedAttempt(),
      lessonId: 'lesson-operation-signals',
      lessonAttemptId: '40000000-0000-4000-8000-000000000004',
    };
    const user = userEvent.setup();
    renderLessonAssessment();

    await user.click(await screen.findByRole('button', { name: 'Continue to first chapter' }));
    expect(queueAttemptStageTransition).toHaveBeenCalledWith(
      userId,
      'lesson-operation-signals',
      server.lessonAttemptId,
      'pre-test',
    );
    expect(await screen.findByText('Lesson player resumed')).toBeInTheDocument();
  });

  it('starts a scoped post-test locally without waiting for lesson replay', async () => {
    server = null;
    vi.mocked(getAssessmentQuestions).mockResolvedValue(
      questions.map((question) => ({ ...question, assessment: 'post-test' })),
    );
    vi.mocked(startAssessment).mockImplementation(async () => {
      server = { ...attempt(), assessment: 'post-test' };
      return server;
    });
    const user = userEvent.setup();
    renderLessonAssessment('post-test');

    await user.click(await screen.findByRole('button', { name: 'Start post-test' }));

    expect(await screen.findByText('Question 1 of 1')).toBeVisible();
    expect(flushPendingLessonAttempt).not.toHaveBeenCalled();
    expect(startAssessment).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'finishes the cached Post-test with the appropriate online/offline result flow (online=%s)',
    async (online) => {
      Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
      const lesson = structuredClone(packagedContent.lessons[0]);
      const postQuestions = twoQuestions.map((question) => ({
        ...question,
        assessment: 'post-test' as const,
        contentVersion: 2,
        id: `post-${question.id}`,
      }));
      const lessonAttemptId = '40000000-0000-4000-8000-000000000004';
      const lessonAttempt = {
        id: lessonAttemptId,
        userId,
        lessonId: lesson.id,
        contentVersion: lesson.contentVersion,
        status: 'active' as const,
        startedAt: 1,
        lastUpdatedAt: 2,
        completedAt: null,
        abandonedAt: null,
        answers: lesson.activities.map((activity) => ({
          activityId: activity.id,
          activityType: activity.type,
          answer:
            activity.type === 'organize-translate'
              ? (activity.correctTokenSequence ?? [])
              : activity.correctChoiceId,
          isCorrect: true,
          submittedAt: 2,
        })),
        finalScore: null,
        starCount: null,
        cleared: null,
        xpImprovement: 0,
        flowStage: 'post-test' as const,
        currentChapterId: `chapter-${lesson.id}`,
        preAssessmentVersion: 1,
        postAssessmentVersion: 2,
      };
      await saveLessonDraft(
        createLessonDraft(lessonAttempt, lesson, lesson.activities.length, {
          'post-test': postQuestions,
        }),
      );
      server = null;
      vi.mocked(getAssessmentQuestions).mockResolvedValue(postQuestions);
      vi.mocked(getAssessmentAttempt).mockResolvedValue(null);
      vi.mocked(startAssessment).mockImplementation(async () => {
        server = {
          ...attempt(),
          assessment: 'post-test',
          lessonId: lesson.id,
          lessonAttemptId,
          contentVersion: 2,
        };
        return server;
      });

      const user = userEvent.setup();
      const first = renderLessonAssessment('post-test');

      expect(await screen.findByRole('button', { name: 'Start post-test' })).toBeEnabled();
      expect(screen.queryByRole('heading', { name: 'We couldnâ€™t load this test' })).toBeNull();
      expect(getAssessmentQuestions).not.toHaveBeenCalled();
      expect(getAssessmentAttempt).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Start post-test' }));
      expect(await screen.findByText('Question 1 of 2')).toBeVisible();
      expect(startAssessment).not.toHaveBeenCalled();
      await user.click(screen.getByRole('radio', { name: 'The sum of two values' }));
      await user.click(screen.getByRole('button', { name: 'Next question' }));
      expect(await screen.findByText('Question 2 of 2')).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Previous' }));
      await screen.findByText('Question 1 of 2');
      expect(await screen.findByRole('radio', { name: 'The sum of two values' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await user.click(screen.getByRole('button', { name: 'Next question' }));
      await screen.findByText('Question 2 of 2');
      await user.click(await screen.findByRole('radio', { name: 'The quotient of two values' }));
      const confirmation = online ? deferred<void>() : null;
      if (confirmation)
        vi.mocked(flushPendingAssessmentDraft).mockReturnValueOnce(confirmation.promise);
      await user.click(screen.getByRole('button', { name: 'Submit test' }));
      const notice =
        'Your answers are saved on this device. Your results will be available once you’re back online.';
      if (online) {
        expect(await screen.findByText('Confirming your official result…')).toBeVisible();
        expect(screen.queryByText(/Answers saved on this device/)).toBeNull();
        await act(async () => confirmation!.resolve());
        expect(await screen.findByText('Official lesson result')).toBeVisible();
        expect(flushPendingAssessmentDraft).toHaveBeenCalledOnce();
        expect(flushPendingLessonAttempt).toHaveBeenCalledWith(userId, lesson.id, lessonAttemptId);
        expect(screen.queryByText(notice)).toBeNull();
        return;
      }
      expect(await screen.findByText(notice)).toBeVisible();
      expect(completeAssessment).not.toHaveBeenCalled();
      expect(await getLessonDraft(userId, lesson.id, lessonAttemptId)).toMatchObject({
        pendingCompletion: true,
        attempt: {
          status: 'active',
          flowStage: 'ready-to-complete',
          finalScore: null,
          starCount: null,
          xpImprovement: 0,
        },
      });
      first.unmount();
      renderLessonAssessment('post-test');
      expect(await screen.findByText(notice)).toBeVisible();
      expect(screen.queryByRole('radio')).toBeNull();
      const saved = await getAssessmentDraft(userId, 'post-test', db, lessonAttemptId);
      expect(saved).toMatchObject({
        pendingStart: true,
        syncStatus: 'pending_submission',
        answers: [
          { questionId: 'post-q1', selectedChoiceId: 'a' },
          { questionId: 'post-q2', selectedChoiceId: 'b' },
        ],
      });
      expect(
        (await getLessonDraft(userId, lesson.id, lessonAttemptId))?.pendingStageTransitions,
      ).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Return to lesson' }));
      expect(await screen.findByText('Lesson overview')).toBeVisible();
    },
  );

  it('shows the underlying Post-test attempt bootstrap error instead of a connectivity guess', async () => {
    server = null;
    vi.mocked(getAssessmentQuestions).mockResolvedValue(
      questions.map((question) => ({ ...question, assessment: 'post-test' })),
    );
    vi.mocked(getAssessmentAttempt).mockRejectedValueOnce(
      new Error('Unable to restore this assessment.'),
    );
    renderLessonAssessment('post-test');

    expect(await screen.findByText('Unable to restore this assessment.')).toBeVisible();
  });

  it('explains that the final question needs an answer instead of silently disabling Submit', async () => {
    const user = userEvent.setup();
    renderAssessment();

    const submit = await screen.findByRole('button', { name: 'Submit test' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(screen.getByText('Choose an answer before submitting.')).toBeInTheDocument();
  });

  it('waits for result readiness before playing completion audio', async () => {
    const delayedQuestions = deferred<AssessmentQuestion[]>();
    server = submittedAttempt();
    vi.mocked(getAssessmentQuestions).mockReturnValueOnce(delayedQuestions.promise);
    vi.mocked(getAssessmentAttempt).mockResolvedValueOnce(server);
    renderAssessment();

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(audio.playCompletion).not.toHaveBeenCalled();
    expect(audio.playReward).not.toHaveBeenCalled();

    await act(async () => delayedQuestions.resolve(questions));
    await screen.findByText('Pre-test complete');
    expect(audio.playCompletion).toHaveBeenCalledTimes(1);
    expect(audio.playCompletion).toHaveBeenCalledWith(server.id);
    expect(audio.playReward).not.toHaveBeenCalled();
  });

  it('fires completion audio only from the mounted final-result branch', async () => {
    server = submittedAttempt();
    audio.playCompletion.mockImplementationOnce(() => {
      expect(document.querySelector('.assessment-result')).toBeInTheDocument();
      expect(screen.getByText('Pre-test complete')).toBeInTheDocument();
    });
    renderAssessment();
    await screen.findByText('Pre-test complete');
    await waitFor(() => expect(audio.playCompletion).toHaveBeenCalledTimes(1));
    expect(audio.playReward).not.toHaveBeenCalled();
  });

  it('plays reward instead of completion for a perfect assessment', async () => {
    server = submittedAttempt(100);
    renderAssessment();

    await screen.findByText('Pre-test complete');
    await waitFor(() => expect(audio.playReward).toHaveBeenCalledOnce());
    expect(audio.playReward).toHaveBeenCalledWith(server.id);
    expect(audio.playCompletion).not.toHaveBeenCalled();
  });

  it('does not play completion audio when result bootstrap fails', async () => {
    server = submittedAttempt();
    vi.mocked(getAssessmentQuestions).mockRejectedValueOnce(new Error('network'));
    vi.mocked(getAssessmentAttempt).mockResolvedValueOnce(server);
    renderAssessment();

    await screen.findByRole('heading', { name: 'We couldn’t load this test' });
    expect(audio.playCompletion).not.toHaveBeenCalled();
    expect(audio.playReward).not.toHaveBeenCalled();
  });

  it('plays once after a failed result load is retried successfully', async () => {
    server = submittedAttempt();
    vi.mocked(getAssessmentQuestions)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(questions);
    vi.mocked(getAssessmentAttempt).mockResolvedValue(server);
    const user = userEvent.setup();
    renderAssessment();

    await screen.findByRole('heading', { name: 'We couldn’t load this test' });
    expect(audio.playCompletion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Pre-test complete');
    expect(audio.playCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not replay completion audio on a result rerender', async () => {
    server = submittedAttempt();
    const view = renderAssessment();
    await screen.findByText('Pre-test complete');
    await waitFor(() => expect(audio.playCompletion).toHaveBeenCalledTimes(1));
    view.rerender(
      <MemoryRouter initialEntries={['/assessments/pre-test']}>
        <Routes>
          <Route path="/assessments/:kind" element={<AssessmentPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Pre-test complete')).toBeInTheDocument());
    expect(audio.playCompletion).toHaveBeenCalledTimes(1);
  });

  it('shows neutral introduction and completion guidance with unchanged result actions', async () => {
    server = null;
    const user = userEvent.setup();
    renderAssessment();
    await screen.findByRole('heading', { name: 'Check what you know' });
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'neutral',
    );
    await user.click(screen.getByRole('button', { name: 'Start pre-test' }));
    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByText('Pre-test complete');
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'neutral',
    );
    expect(
      screen.getByText('Correct answers are hidden while the research is in progress.')
        .parentElement,
    ).toHaveClass('result-actions', 'assessment-result__actions');
    await waitFor(() => expect(audio.playReward).toHaveBeenCalledWith(attempt().id));
    expect(audio.playCompletion).not.toHaveBeenCalled();
    expect(audio.playSfx).not.toHaveBeenCalledWith('correct');
    expect(audio.playSfx).not.toHaveBeenCalledWith('incorrect');
    await expect(getAssessmentDraft(userId, 'pre-test')).resolves.toBeNull();
  });
  it.each(['pre-test', 'post-test'] as const)(
    'retains neutral guidance and accessible immediate choices in %s',
    async (kind) => {
      server = { ...attempt(), assessment: kind };
      vi.mocked(getAssessmentQuestions).mockResolvedValue(
        questions.map((q) => ({ ...q, assessment: kind })),
      );
      const pending = deferred<AssessmentAttempt>();
      vi.mocked(syncAssessmentDraft).mockReturnValue(pending.promise);
      const user = userEvent.setup();
      const view = renderAssessment(kind);
      const choice = await screen.findByRole('radio', { name: 'The sum of two values' });
      await user.click(choice);
      expect(choice).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radiogroup')).toHaveAccessibleName(questions[0].prompt);
      expect(screen.getByRole('button', { name: 'Submit test' })).toBeEnabled();
      expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
        'data-character-state',
        'explaining',
      );
      expect(view.container.querySelector('[data-character-state="correct"]')).toBeNull();
      view.unmount();
      await act(async () => pending.resolve(server!));
    },
  );
  it('keeps Next immediate and does not double-save when navigation is repeated during a slow sync', async () => {
    server = { ...attempt(), expectedQuestionCount: 2 };
    vi.mocked(getAssessmentQuestions).mockResolvedValue(twoQuestions);
    const pending = deferred<void>();
    vi.mocked(syncAssessmentDraft).mockImplementation(async (snapshot) => {
      await pending.promise;
      return accept(snapshot);
    });
    const user = userEvent.setup();
    renderAssessment();
    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.dblClick(screen.getByRole('button', { name: 'Next question' }));
    expect(await screen.findByRole('heading', { name: twoQuestions[1].prompt })).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    await act(async () => pending.resolve());
    await waitFor(() => expect(syncAssessmentDraft).toHaveBeenCalledTimes(1));
  });
  it('moves to the next question in a lesson-scoped pre-test while online', async () => {
    server = {
      ...attempt(),
      id: '10000000-0000-4000-8000-000000000009',
      lessonId: 'lesson-operation-signals',
      lessonAttemptId: '40000000-0000-4000-8000-000000000004',
      expectedQuestionCount: 2,
    };
    vi.mocked(getAssessmentQuestions).mockResolvedValue(twoQuestions);
    const user = userEvent.setup();
    renderLessonAssessment();

    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    const next = screen.getByRole('button', { name: 'Next question' });
    expect(next).toBeEnabled();
    await user.click(next);

    expect(await screen.findByText('Question 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: twoQuestions[1].prompt })).toBeInTheDocument();
  });
  it('does not flash the last question while a restored lesson submission is being confirmed', async () => {
    await cacheLessonPreTest(twoQuestions);
    server = {
      ...attempt(),
      id: '10000000-0000-4000-8000-000000000010',
      lessonId: 'lesson-operation-signals',
      lessonAttemptId: '40000000-0000-4000-8000-000000000004',
      expectedQuestionCount: 2,
    };
    vi.mocked(getAssessmentQuestions).mockResolvedValue(twoQuestions);
    const pending = markDraftPendingSubmission(
      updateDraftAnswer(
        updateDraftAnswer(createAssessmentDraft(server, twoQuestions), 'q1', 'a'),
        'q2',
        'b',
      ),
    );
    await saveAssessmentDraft(pending);
    const sync = deferred<AssessmentAttempt>();
    vi.mocked(syncAssessmentDraft).mockReturnValue(sync.promise);
    renderLessonAssessment();

    expect(await screen.findByText('Submission saved')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: twoQuestions[0].prompt })).not.toBeInTheDocument();

    await act(async () => sync.resolve(accept(pending)));
    expect(screen.getByRole('button', { name: 'Continue Lesson' })).toBeEnabled();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(syncAssessmentDraft).not.toHaveBeenCalled();
  });
  it('freezes editing and serializes Submit behind autosync', async () => {
    const pending = deferred<void>();
    vi.mocked(syncAssessmentDraft).mockImplementation(async (snapshot) => {
      await pending.promise;
      return accept(snapshot);
    });
    const user = userEvent.setup();
    renderAssessment();
    const choice = await screen.findByRole('radio', { name: 'The sum of two values' });
    await user.click(choice);
    await waitFor(() => expect(syncAssessmentDraft).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    expect(await screen.findByText('Confirming your saved result…')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(completeAssessment).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => pending.resolve());
    await screen.findByText('Pre-test complete');
    expect(syncAssessmentDraft).toHaveBeenCalledTimes(1);
    expect(completeAssessment).toHaveBeenCalledTimes(1);
  });
  it('surfaces local write failures, retains memory answers, and submits those rather than stale disk data', async () => {
    const pending = deferred<void>();
    vi.mocked(syncAssessmentDraft).mockImplementation(async (snapshot) => {
      await pending.promise;
      return accept(snapshot);
    });
    const user = userEvent.setup();
    renderAssessment();
    const choice = await screen.findByRole('radio', { name: 'The quotient of two values' });
    vi.spyOn(db.assessmentDrafts, 'put').mockRejectedValue(new Error('QuotaExceededError'));
    await user.click(choice);
    await screen.findByText(/Local saving failed/);
    expect(choice).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(/Saved on this device/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    await act(async () => pending.resolve());
    await screen.findByText('Pre-test complete');
    expect(server?.answers[0].selectedChoiceId).toBe('b');
    expect(completeAssessment).toHaveBeenCalledWith(
      userId,
      'pre-test',
      attempt().id,
      1,
      undefined,
      expect.any(Function),
    );
    expect(await getAssessmentDraft(userId, 'pre-test')).not.toBeNull(); // Older local revision is not deleted.
  });
  it('automatically recovers a committed result whose completion response was lost', async () => {
    const complete = vi.mocked(completeAssessment).getMockImplementation()!;
    vi.mocked(completeAssessment).mockImplementationOnce(async (...args) => {
      await complete(...args);
      throw new Error('timeout');
    });
    const user = userEvent.setup();
    renderAssessment();
    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByText('Pre-test complete');
    expect(syncAssessmentDraft).toHaveBeenCalledTimes(1);
    expect(completeAssessment).toHaveBeenCalledTimes(1);
  });
  it.each(['pre-test', 'post-test'] as const)(
    'retains pending offline %s submission and recovers on reconnect',
    async (kind) => {
      server = { ...attempt(), assessment: kind };
      vi.mocked(getAssessmentQuestions).mockResolvedValue(
        questions.map((question) => ({ ...question, assessment: kind })),
      );
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      vi.mocked(syncAssessmentDraft).mockRejectedValue(new Error('offline'));
      const user = userEvent.setup();
      renderAssessment(kind);
      await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
      await user.click(screen.getByRole('button', { name: 'Submit test' }));
      await screen.findByText(/Submission is pending/);
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      await expect(getAssessmentDraft(userId, kind)).resolves.toMatchObject({
        syncStatus: 'pending_submission',
      });
      expect(completeAssessment).not.toHaveBeenCalled();
      vi.mocked(syncAssessmentDraft).mockImplementation(async (snapshot) => accept(snapshot));
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      act(() => window.dispatchEvent(new Event('online')));
      await screen.findByText(`${kind === 'pre-test' ? 'Pre-test' : 'Post-test'} complete`);
    },
  );
  it('keeps the final choice while a three-question offline submission reconnects', async () => {
    const threeQuestions = [
      questions[0],
      { ...questions[0], id: 'q2', displayOrder: 2, prompt: 'Second question' },
      { ...questions[0], id: 'q3', displayOrder: 3, prompt: 'Third question' },
    ];
    server = { ...attempt(), expectedQuestionCount: 3 };
    vi.mocked(getAssessmentQuestions).mockResolvedValue(threeQuestions);
    vi.mocked(syncAssessmentDraft).mockRejectedValue(new Error('offline'));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    renderAssessment();

    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    await user.click(await screen.findByRole('radio', { name: 'The quotient of two values' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    const finalChoice = await screen.findByRole('radio', { name: 'The sum of two values' });
    await user.click(finalChoice);
    expect(finalChoice).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByText(/Submission is pending/);

    vi.mocked(syncAssessmentDraft).mockImplementation(async (snapshot) => accept(snapshot));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => window.dispatchEvent(new Event('online')));

    await screen.findByText('Pre-test complete');
    expect(server?.answers).toHaveLength(3);
  });
  it.each(['pre-test', 'post-test'] as const)(
    'continues %s from a durable local draft when requests fail offline',
    async (kind) => {
      const kindQuestions = questions.map((question) => ({ ...question, assessment: kind }));
      const local = updateDraftAnswer(
        createAssessmentDraft({ ...attempt(), assessment: kind }, kindQuestions),
        'q1',
        'b',
      );
      await saveAssessmentDraft(local);
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      vi.mocked(getAssessmentQuestions).mockRejectedValueOnce(new Error('offline'));
      vi.mocked(getAssessmentAttempt).mockRejectedValueOnce(new Error('offline'));
      vi.mocked(syncAssessmentDraft).mockRejectedValue(new Error('offline'));

      renderAssessment(kind);

      expect(
        await screen.findByRole('radio', { name: 'The quotient of two values' }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(
        await screen.findByText('Saved on this device.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'We couldn’t load this test' }),
      ).not.toBeInTheDocument();
      await expect(getAssessmentDraft(userId, kind)).resolves.toMatchObject({
        answers: [expect.objectContaining({ questionId: 'q1', selectedChoiceId: 'b' })],
      });
    },
  );
  it('recovers an already submitted attempt before replaying a pending local snapshot', async () => {
    const local = markDraftPendingSubmission(
      updateDraftAnswer(createAssessmentDraft(attempt(), questions), 'q1', 'a'),
    );
    await saveAssessmentDraft(local);
    server = {
      ...accept(local),
      status: 'submitted',
      score: 100,
      submittedRevision: local.revision,
      submittedAt: 2,
    };
    renderAssessment();
    await screen.findByText('Pre-test complete');
    expect(syncAssessmentDraft).not.toHaveBeenCalled();
    expect(completeAssessment).not.toHaveBeenCalled();
    await expect(getAssessmentDraft(userId, 'pre-test')).resolves.toBeNull();
  });
  it.each(['questions', 'attempt', 'local', 'empty'] as const)(
    'shows a recoverable bootstrap error for %s failure and retry works',
    async (failure) => {
      if (failure === 'questions')
        vi.mocked(getAssessmentQuestions).mockRejectedValueOnce(new Error('network'));
      if (failure === 'attempt')
        vi.mocked(getAssessmentAttempt).mockRejectedValueOnce(new Error('network'));
      if (failure === 'empty') vi.mocked(getAssessmentQuestions).mockResolvedValueOnce([]);
      if (failure === 'local')
        vi.spyOn(db.assessmentDrafts, 'where').mockImplementationOnce(() => {
          throw new Error('IDB unavailable');
        });
      const user = userEvent.setup();
      renderAssessment();
      await screen.findByRole('heading', { name: 'We couldn’t load this test' });
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await screen.findByRole('radiogroup');
    },
  );
  it('ignores stale bootstrap responses when the authenticated user changes', async () => {
    const pending = deferred<AssessmentAttempt | null>();
    vi.mocked(getAssessmentAttempt).mockReturnValueOnce(pending.promise).mockResolvedValue(null);
    const user = userEvent.setup();
    renderAssessment();
    act(() =>
      useAuthStore.setState({
        user: { ...useAuthStore.getState().user!, id: crypto.randomUUID() },
      }),
    );
    await screen.findByRole('heading', { name: 'Check what you know' });
    await act(async () => pending.resolve(attempt()));
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(startAssessment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Not now' }));
  });
  it('keeps attempt creation failure recoverable without mounting a broken player', async () => {
    server = null;
    vi.mocked(startAssessment).mockRejectedValueOnce(new Error('Unable to start the test.'));
    const user = userEvent.setup();
    renderAssessment();
    await user.click(await screen.findByRole('button', { name: 'Start pre-test' }));
    await screen.findByText('Unable to start the test.');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start pre-test' }));
    await screen.findByRole('radiogroup');
  });
  it('reports incompatible local content as a recoverable error without discarding it', async () => {
    const local = createAssessmentDraft(attempt(), questions);
    await saveAssessmentDraft({
      ...local,
      contentVersion: 2,
      questions: questions.map((q) => ({ ...q, contentVersion: 2 })),
    });
    renderAssessment();
    await screen.findByRole('heading', { name: 'We couldn’t load this test' });
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(await getAssessmentDraft(userId, 'pre-test')).not.toBeNull();
  });
  it('restores an invalid local index safely without dereferencing an empty question', async () => {
    const local = updateDraftAnswer(createAssessmentDraft(attempt(), questions), 'q1', 'b');
    await saveAssessmentDraft({ ...local, currentQuestionIndex: 999 });
    renderAssessment();
    await screen.findByRole('radiogroup');
    expect(screen.getByText('Question 1 of 1')).toBeInTheDocument();
  });
  it('preserves unsynced local answers despite newer wall-clock timestamps on the server', async () => {
    const local = updateDraftAnswer(createAssessmentDraft(attempt(), questions), 'q1', 'b', 1);
    await saveAssessmentDraft(local);
    server = {
      ...attempt(),
      answers: [{ questionId: 'q1', selectedChoiceId: 'a', answeredAt: 999999999 }],
    };
    vi.mocked(syncAssessmentDraft).mockReturnValue(new Promise(() => undefined));
    renderAssessment();
    expect(
      await screen.findByRole('radio', { name: 'The quotient of two values' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
  it('visibly restores the persisted selected choice after the assessment is reopened', async () => {
    const local = updateDraftAnswer(createAssessmentDraft(attempt(), questions), 'q1', 'b');
    await saveAssessmentDraft(local);

    const firstView = renderAssessment();
    expect(
      await screen.findByRole('radio', { name: 'The quotient of two values' }),
    ).toHaveAttribute('aria-checked', 'true');
    firstView.unmount();

    renderAssessment();
    expect(
      await screen.findByRole('radio', { name: 'The quotient of two values' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'The sum of two values' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
  it('disposes reconnect/focus/visibility handlers after leaving the attempt', async () => {
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const view = renderAssessment();
    await screen.findByRole('radiogroup');
    view.unmount();
    expect(removeWindow).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
