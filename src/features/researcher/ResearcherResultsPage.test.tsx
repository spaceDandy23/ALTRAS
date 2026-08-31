import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearcherParticipantResult } from './researcher.service';
import { ResearcherResultsPage } from './ResearcherResultsPage';
import { getResearcherResults } from './researcher.service';

vi.mock('./researcher.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./researcher.service')>();
  return { ...actual, getResearcherResults: vi.fn() };
});

const results: ResearcherParticipantResult[] = [
  {
    participantCode: 'ALT-8F21C4A1',
    preTestStatus: 'completed',
    preTestScore: 45,
    preTestCompletedAt: 1,
    postTestStatus: 'completed',
    postTestScore: 70,
    postTestCompletedAt: 2,
    lessonsCompleted: 2,
    lessonsAvailable: 2,
    latestActivityAt: 3,
    lessonResults: [
      {
        lessonId: 'lesson-1',
        status: 'cleared',
        bestScore: 100,
        latestScore: 100,
        attemptCount: 1,
        completedAt: 3,
        activeSeconds: 65,
      },
    ],
  },
  {
    participantCode: 'ALT-8F21C4A2',
    preTestStatus: 'completed',
    preTestScore: 80,
    preTestCompletedAt: 1,
    postTestStatus: 'not_started',
    postTestScore: null,
    postTestCompletedAt: null,
    lessonsCompleted: 1,
    lessonsAvailable: 2,
    latestActivityAt: null,
    lessonResults: [],
  },
];

describe('researcher results dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an accessible centered loading state while results are requested', () => {
    vi.mocked(getResearcherResults).mockReturnValue(new Promise(() => undefined));
    render(<ResearcherResultsPage />);

    const loading = screen.getByRole('status');
    expect(loading).toHaveClass('researcher-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent('Loading anonymized participant results…');
  });

  it('renders an empty dataset without misleading averages', async () => {
    vi.mocked(getResearcherResults).mockResolvedValue([]);
    render(<ResearcherResultsPage />);

    expect(await screen.findByText('No participant data yet')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('supports search, filters, sorting, and anonymized participant details', async () => {
    vi.mocked(getResearcherResults).mockResolvedValue(results);
    const user = userEvent.setup();
    render(<ResearcherResultsPage />);

    await screen.findByText('ALT-8F21C4A1');
    await user.selectOptions(screen.getByLabelText('Assessment filter'), 'both-completed');
    expect(screen.getByText('ALT-8F21C4A1')).toBeInTheDocument();
    expect(screen.queryByText('ALT-8F21C4A2')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Assessment filter'), 'all');
    await user.clear(screen.getByLabelText('Find participant code'));
    await user.type(screen.getByLabelText('Find participant code'), 'a2');
    expect(screen.getByText('ALT-8F21C4A2')).toBeInTheDocument();
    expect(screen.queryByText('ALT-8F21C4A1')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Find participant code'));
    await user.selectOptions(screen.getByLabelText('Sort by'), 'pre-score');
    await user.click(screen.getByRole('button', { name: 'Ascending' }));
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('ALT-8F21C4A2');

    const detailsButton = screen.getAllByRole('button', { name: 'View details' })[1];
    await user.click(detailsButton);
    expect(screen.getByRole('dialog', { name: 'ALT-8F21C4A1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close details' })).toHaveFocus();
    expect(screen.getByText('Read-only participant detail')).toBeInTheDocument();
    expect(screen.getByText('lesson-1')).toBeInTheDocument();
    expect(screen.queryByText('student@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('00000000-0000-0000-0000-000000000000')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(detailsButton).toHaveFocus();
  });

  it('paginates participants and preserves the page while details open and close', async () => {
    const manyResults = Array.from({ length: 17 }, (_, index) => ({
      ...results[1],
      participantCode: `ALT-${String(index + 1).padStart(8, '0')}`,
    }));
    vi.mocked(getResearcherResults).mockResolvedValue(manyResults);
    const user = userEvent.setup();
    render(<ResearcherResultsPage />);

    expect(await screen.findByText('ALT-00000001')).toBeInTheDocument();
    expect(screen.queryByText('ALT-00000016')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('ALT-00000016')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    const detailsButton = screen.getAllByRole('button', { name: 'View details' })[0];
    await user.click(detailsButton);
    expect(screen.getByRole('dialog', { name: 'ALT-00000016' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    expect(getResearcherResults).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('ALT-00000016')).toBeInTheDocument();
    expect(detailsButton).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('reports loading failures without rendering participant data', async () => {
    vi.mocked(getResearcherResults).mockRejectedValue(new Error('Researcher access required.'));
    render(<ResearcherResultsPage />);

    await waitFor(() => expect(screen.getByText('Results are unavailable')).toBeInTheDocument());
    expect(screen.queryByText('ALT-8F21C4A1')).not.toBeInTheDocument();
  });
});
