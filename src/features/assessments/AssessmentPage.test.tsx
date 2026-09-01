import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import type { AssessmentAttempt, AssessmentQuestion } from '@/types/assessment';
import { AssessmentPage } from './AssessmentPage';
import {
  completeAssessment,
  getAssessmentAttempt,
  getAssessmentQuestions,
  submitAssessmentAnswer,
} from './assessment.service';

vi.mock('./assessment.service', () => ({
  completeAssessment: vi.fn(),
  getAssessmentAttempt: vi.fn(),
  getAssessmentQuestions: vi.fn(),
  startAssessment: vi.fn(),
  submitAssessmentAnswer: vi.fn(),
}));

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
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
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

    const choice = await screen.findByRole('button', { name: 'The sum of two values' });
    await user.click(choice);

    expect(choice).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: 'Submit test' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving answer…');
  });

  it('waits for an in-flight save and then advances automatically', async () => {
    authenticate(twoQuestions);
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderAssessment();

    await user.click(await screen.findByRole('button', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.getByRole('button', { name: 'Saving and continuing…' })).toBeDisabled();

    await act(async () => pendingSave.resolve(attempt('active', [answer()])));
    expect(
      await screen.findByRole('heading', { name: twoQuestions[1].prompt }),
    ).toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: 'The sum of two values' }));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));
    expect(screen.getByRole('button', { name: 'Saving and submitting…' })).toBeDisabled();
    expect(completeAssessment).not.toHaveBeenCalled();

    await act(async () => pendingSave.resolve(attempt('active', [answer()])));
    expect(await screen.findByText('Pre-test complete')).toBeInTheDocument();
    expect(completeAssessment).toHaveBeenCalledTimes(1);
  });

  it('does not advance or complete when saving fails and preserves the choice for retry', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderAssessment();

    const choice = await screen.findByRole('button', { name: 'The sum of two values' });
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

    vi.mocked(submitAssessmentAnswer).mockResolvedValue(attempt('active', [answer()]));
    vi.mocked(completeAssessment).mockResolvedValue(attempt('submitted', [answer()]));
    await user.click(screen.getByRole('button', { name: 'Submit test' }));

    expect(await screen.findByText('Pre-test complete')).toBeInTheDocument();
    expect(submitAssessmentAnswer).toHaveBeenCalledTimes(2);
    expect(completeAssessment).toHaveBeenCalledTimes(1);
  });

  it('guards rapid repeated navigation without duplicate saves or skipped questions', async () => {
    authenticate(twoQuestions);
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const pendingSave = deferred<AssessmentAttempt>();
    vi.mocked(submitAssessmentAnswer).mockReturnValue(pendingSave.promise);
    const user = userEvent.setup();
    renderAssessment();

    await user.click(await screen.findByRole('button', { name: 'The sum of two values' }));
    const next = screen.getByRole('button', { name: 'Next question' });
    await user.dblClick(next);
    await act(async () => pendingSave.resolve(attempt('active', [answer()])));

    expect(
      await screen.findByRole('heading', { name: twoQuestions[1].prompt }),
    ).toBeInTheDocument();
    expect(submitAssessmentAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
  });
});
