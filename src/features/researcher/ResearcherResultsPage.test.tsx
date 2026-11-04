import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearcherParticipantResult } from './researcher.service';
import { ResearcherResultsPage } from './ResearcherResultsPage';
import { getResearcherResults } from './researcher.service';
import { ResearcherDataProvider } from './ResearcherDataContext';

vi.mock('./researcher.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./researcher.service')>();
  return { ...actual, getResearcherResults: vi.fn() };
});

const results: ResearcherParticipantResult[] = [
  {
    participantCode: 'ALT-8F21C4A1', username: 'student-one', lessonsCompleted: 2,
    lessonsAvailable: 2, latestActivityAt: 3,
    lessonResults: [{ lessonId: 'lesson-1', status: 'cleared', bestScore: 100, latestScore: 100, attemptCount: 1, completedAt: 3, activeSeconds: 65 }],
  },
  {
    participantCode: 'ALT-8F21C4A2', username: 'student-two', lessonsCompleted: 1,
    lessonsAvailable: 2, latestActivityAt: null, lessonResults: [],
  },
];
function renderPage() {
  return render(<ResearcherDataProvider><ResearcherResultsPage /></ResearcherDataProvider>);
}

describe('researcher participant learning results', () => {
  beforeEach(() => vi.clearAllMocks());
  it('renders a loading state while participant progress is requested', () => {
    vi.mocked(getResearcherResults).mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('status')).toHaveClass('researcher-content-loading');
  });
  it('renders an empty participant dataset clearly', async () => {
    vi.mocked(getResearcherResults).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No participant data yet')).toBeInTheDocument();
  });
  it('supports participant search, sorting, and lesson-only details', async () => {
    vi.mocked(getResearcherResults).mockResolvedValue(results);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ALT-8F21C4A1');
    await user.clear(screen.getByLabelText('Find participant code or username'));
    await user.type(screen.getByLabelText('Find participant code or username'), 'student-two');
    expect(screen.getByText('ALT-8F21C4A2')).toBeInTheDocument();
    expect(screen.queryByText('ALT-8F21C4A1')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Find participant code or username'));
    await user.selectOptions(screen.getByLabelText('Sort by'), 'lessons-completed');
    await user.click(screen.getByRole('button', { name: 'Ascending' }));
    const detailsButton = screen.getAllByRole('button', { name: 'View details' })[0];
    await user.click(detailsButton);
    expect(screen.getByRole('dialog', { name: 'ALT-8F21C4A1 · student-one' })).toBeInTheDocument();
    expect(screen.getByText('lesson-1')).toBeInTheDocument();
    expect(screen.queryByText('Pre-test')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(detailsButton).toHaveFocus();
  });
  it('paginates participants and preserves state while details open and close', async () => {
    vi.mocked(getResearcherResults).mockResolvedValue(Array.from({ length: 17 }, (_, index) => ({
      ...results[1], participantCode: `ALT-${String(index + 1).padStart(8, '0')}`,
    })));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('ALT-00000001')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('ALT-00000016')).toBeInTheDocument();
    const detailsButton = screen.getAllByRole('button', { name: 'View details' })[0];
    await user.click(detailsButton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(detailsButton).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });
  it('reports loading failures without rendering participant data', async () => {
    vi.mocked(getResearcherResults).mockRejectedValue(new Error('Researcher access required.'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Results are unavailable')).toBeInTheDocument());
    expect(screen.queryByText('ALT-8F21C4A1')).not.toBeInTheDocument();
  });
});
