import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { db } from '@/db/database';
import type { AssessmentAttempt, AssessmentQuestion } from '@/types/assessment';
import { AssessmentPage } from './AssessmentPage.async';
import {
  createAssessmentDraft,
  getAssessmentDraft,
  saveAssessmentDraft,
  updateDraftAnswer,
} from './assessment-draft.service';
import {
  completeAssessment,
  getAssessmentAttempt,
  getAssessmentQuestions,
  submitAssessmentAnswer,
} from './assessment.service';

const audio = vi.hoisted(() => ({
  playCompletion: vi.fn(),
  playSfx: vi.fn(),
}));

vi.mock('./assessment.service', () => ({
  completeAssessment: vi.fn(),
  getAssessmentAttempt: vi.fn(),
  getAssessmentQuestions: vi.fn(),
  startAssessment: vi.fn(),
  submitAssessmentAnswer: vi.fn(),
}));
vi.mock('@/services/audio/audio.manager', () => audio);

const userId = '20000000-0000-4000-8000-000000000002';
const questions: AssessmentQuestion[] = [
  {
    id: 'pre-question-1',
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

const twoQuestions: AssessmentQuestion[] = [
  ...questions,
  {
    ...questions[0],
    id: 'pre-question-2',
    displayOrder: 2,
    prompt: 'Which phrase represents division?',
  },
];

function answer(questionId = questions[0].id, selectedChoiceId = 'a') {
  return { questionId, selectedChoiceId, answeredAt: 2 };
}

function attempt(
  status: 'active' | 'submitted',
  answers: AssessmentAttempt['answers'] = [],
): AssessmentAttempt {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    userId,
    assessment: 'pre-test',
    status,
    startedAt: 1,
    submittedAt: status === 'submitted' ? 2 : null,
    score: status === 'submitted' ? 100 : null,
    completionSeconds: status === 'submitted' ? 60 : null,
    contentVersion: 1,
    expectedQuestionCount: 1,
    answers,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

describe('assessment character guidance', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    await db.assessmentDrafts.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  function authenticate(loadedQuestions = questions) {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'assessment_student',
        displayName: 'Assessment Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    vi.mocked(getAssessmentQuestions).mockResolvedValue(loadedQuestions);
  }

  it('shows only neutral introduction guidance before an assessment starts', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(null);
    renderAssessment();

    await screen.findByRole('heading', { name: 'Check what you know' });
    const companion = screen.getByLabelText('Mina, learning companion');
    expect(companion).toHaveAttribute('data-character-state', 'neutral');
    expect(companion).toHaveTextContent('Take your time');
  });

  it('shows neutral completion guidance after submission', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('submitted'));
    renderAssessment();

    await screen.findByText('Pre-test complete');
    const companion = screen.getByLabelText('Mina, learning companion');
    expect(companion).toHaveAttribute('data-character-state', 'neutral');
    expect(companion).toHaveTextContent('assessment is complete');
    const notice = screen.getByText(
      'Correct answers are hidden while the research is in progress.',
    );
    expect(notice.parentElement).toHaveClass('result-actions', 'assessment-result__actions');
  });

  it.each(['pre-test', 'post-test'] as const)(
    'shows neutral assessment guidance without correctness feedback during the %s',
    async (kind) => {
      authenticate();
      vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
      const { container } = renderAssessment(kind);

      await screen.findByRole('heading', { name: questions[0].prompt });
      const companion = screen.getByLabelText('Mina, learning companion');
      expect(companion).toHaveAttribute('data-character-state', 'explaining');
      expect(companion).toHaveTextContent('Choose the answer that best matches the phrase.');
      expect(container.querySelector('[data-character-state="correct"]')).not.toBeInTheDocument();
      expect(container.querySelector('[data-character-state="incorrect"]')).not.toBeInTheDocument();
    },
  );

  it('shows a selected choice immediately while its save is pending', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderAssessment();

    const choice = await screen.findByRole('radio', { name: 'The sum of two values' });
    await user.click(choice);

    expect(choice).toHaveClass('is-selected');
    expect(choice).toHaveAttribute('role', 'radio');
    expect(choice).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName(questions[0].prompt);
    expect(screen.getByRole('button', { name: 'Submit test' })).toBeEnabled();
    expect(screen.queryByText('Answer saved')).not.toBeInTheDocument();
    await waitFor(async () => {
      expect((await getAssessmentDraft(userId, 'pre-test'))?.answers).toEqual([
        expect.objectContaining({ questionId: questions[0].id, selectedChoiceId: 'a' }),
      ]);
    });
  });

  it('advances immediately while an answer save remains in flight', async () => {
    authenticate(twoQuestions);
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderAssessment();

    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    expect(
      await screen.findByRole('heading', { name: twoQuestions[1].prompt }),
    ).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: twoQuestions[1].prompt })).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await act(async () => pendingSave.resolve(attempt('active', [answer()])));
    expect(submitAssessmentAnswer).toHaveBeenCalledTimes(1);
  });

  it('waits for the final answer save before completing the assessment', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    vi.mocked(completeAssessment).mockResolvedValue(attempt('submitted', [answer()]));
    const user = userEvent.setup();
    renderAssessment();

    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(completeAssessment).not.toHaveBeenCalled();

    await act(async () => pendingSave.resolve(attempt('active', [answer()])));
    expect(await screen.findByText('Pre-test complete')).toBeInTheDocument();
    expect(completeAssessment).toHaveBeenCalledTimes(1);
    expect(audio.playCompletion).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      false,
    );
    expect(audio.playSfx).toHaveBeenCalledWith('click');
    expect(audio.playSfx).not.toHaveBeenCalledWith('correct');
    expect(audio.playSfx).not.toHaveBeenCalledWith('incorrect');
    await expect(getAssessmentDraft(userId, 'pre-test')).resolves.toBeNull();
  });

  it('retains a failed final submission locally and allows retry', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderAssessment();

    const choice = await screen.findByRole('radio', { name: 'The sum of two values' });
    await user.click(choice);
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    await act(async () =>
      pendingSave.reject(new Error('Unable to save this answer. Please try again.')),
    );

    expect(screen.getByRole('heading', { name: questions[0].prompt })).toBeInTheDocument();
    expect(choice).toHaveClass('is-selected');
    expect(
      await screen.findByText('Unable to save this answer. Please try again.'),
    ).toBeInTheDocument();
    expect(completeAssessment).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Submit test' })).toBeEnabled();
    await expect(getAssessmentDraft(userId, 'pre-test')).resolves.toMatchObject({
      syncStatus: 'pending_submission',
    });

    vi.mocked(submitAssessmentAnswer).mockResolvedValue(attempt('active', [answer()]));
    vi.mocked(completeAssessment).mockResolvedValue(attempt('submitted', [answer()]));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));

    expect(await screen.findByText('Pre-test complete')).toBeInTheDocument();
    expect(submitAssessmentAnswer).toHaveBeenCalledTimes(3);
    expect(completeAssessment).toHaveBeenCalledTimes(1);
  });

  it('guards rapid repeated navigation without duplicate saves or skipped questions', async () => {
    authenticate(twoQuestions);
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderAssessment();

    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    const next = screen.getByRole('button', { name: 'Next question' });
    await user.dblClick(next);
    await act(async () => pendingSave.resolve(attempt('active', [answer()])));

    expect(
      await screen.findByRole('heading', { name: twoQuestions[1].prompt }),
    ).toBeInTheDocument();
    expect(submitAssessmentAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
  });

  it('restores a newer unsynced local answer without replacing it with stale server data', async () => {
    authenticate();
    const server = attempt('active', [{ ...answer(), answeredAt: 10 }]);
    const local = updateDraftAnswer(createAssessmentDraft(server, questions), questions[0].id, 'b', 20);
    await saveAssessmentDraft(local);
    vi.mocked(getAssessmentAttempt).mockResolvedValue(server);
    vi.mocked(submitAssessmentAnswer).mockResolvedValue(server);
    renderAssessment();

    expect(await screen.findByRole('radio', { name: 'The quotient of two values' })).toHaveClass(
      'is-selected',
    );
  });

  it('keeps an offline final submission pending instead of showing a result', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    vi.mocked(submitAssessmentAnswer).mockRejectedValue(new Error('offline'));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    renderAssessment();

    await user.click(await screen.findByRole('radio', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));

    expect(
      await screen.findByText(
        'Your answers are saved on this device and will be submitted when you’re back online.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Pre-test complete')).not.toBeInTheDocument();
    expect(completeAssessment).not.toHaveBeenCalled();
    await expect(getAssessmentDraft(userId, 'pre-test')).resolves.toMatchObject({
      syncStatus: 'pending_submission',
    });
  });
});
