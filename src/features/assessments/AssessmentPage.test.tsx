import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { db } from '@/db/database';
import type { AssessmentAttempt, AssessmentDraft, AssessmentQuestion } from '@/types/assessment';
import { AssessmentPage } from './AssessmentPage.async';
import {
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

const audio = vi.hoisted(() => ({
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
    assessment: snapshot.assessment,
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
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  useAuthStore.setState({ status: 'guest', user: null });
  await db.assessmentDrafts.clear();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('assessment UX and bootstrap', () => {
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
    expect(audio.playCompletion).toHaveBeenCalledTimes(1);
    expect(audio.playReward).not.toHaveBeenCalled();
  });

  it('plays reward instead of completion for a perfect assessment', async () => {
    server = submittedAttempt(100);
    renderAssessment();

    await screen.findByText('Pre-test complete');
    expect(audio.playReward).toHaveBeenCalledOnce();
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
    expect(audio.playCompletion).toHaveBeenCalledTimes(1);
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
    expect(audio.playReward).toHaveBeenCalledWith(attempt().id);
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
      vi.mocked(syncAssessmentDraft).mockReturnValue(new Promise(() => undefined));
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
    expect(screen.getByRole('heading', { name: twoQuestions[1].prompt })).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    await act(async () => pending.resolve());
    await waitFor(() => expect(syncAssessmentDraft).toHaveBeenCalledTimes(1));
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
    expect(choice).toBeDisabled();
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
    expect(completeAssessment).toHaveBeenCalledWith(userId, 'pre-test', attempt().id, 1);
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
  it('retains pending offline submission, freezes edits, and recovers on reconnect without reopening', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.mocked(syncAssessmentDraft).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderAssessment();
    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    await screen.findByText(/Submission is pending/);
    expect(screen.getByRole('radio', { name: 'The sum of two values' })).toBeDisabled();
    await expect(getAssessmentDraft(userId, 'pre-test')).resolves.toMatchObject({
      syncStatus: 'pending_submission',
    });
    expect(completeAssessment).not.toHaveBeenCalled();
    vi.mocked(syncAssessmentDraft).mockImplementation(async (snapshot) => accept(snapshot));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => window.dispatchEvent(new Event('online')));
    await screen.findByText('Pre-test complete');
  });
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
