import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import type { AssessmentAttempt, AssessmentQuestion } from '@/types/assessment';
import { AssessmentPage } from './AssessmentPage';
import { getAssessmentAttempt, getAssessmentQuestions } from './assessment.service';

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

function attempt(status: 'active' | 'submitted'): AssessmentAttempt {
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
    answers:
      status === 'active'
        ? [{ questionId: questions[0].id, selectedChoiceId: 'a', answeredAt: 2 }]
        : [],
  };
}

function renderAssessment() {
  return render(
    <MemoryRouter initialEntries={['/assessments/pre-test']}>
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

  function authenticate() {
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
    vi.mocked(getAssessmentQuestions).mockResolvedValue(questions);
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

  it('never shows per-question correctness character reactions', async () => {
    authenticate();
    vi.mocked(getAssessmentAttempt).mockResolvedValue(attempt('active'));
    const { container } = renderAssessment();

    await screen.findByRole('heading', { name: questions[0].prompt });
    expect(container.querySelector('[data-character-id]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-character-state="correct"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-character-state="incorrect"]')).not.toBeInTheDocument();
  });
});
