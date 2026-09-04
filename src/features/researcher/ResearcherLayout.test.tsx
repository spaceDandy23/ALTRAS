import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { ResearcherDashboardPage } from './ResearcherDashboardPage';
import { ResearcherLayout } from './ResearcherLayout';
import { getResearcherResults } from './researcher.service';

vi.mock('./researcher.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./researcher.service')>();
  return { ...actual, getResearcherResults: vi.fn().mockResolvedValue([]) };
});

describe('researcher workspace layout', () => {
  beforeEach(() => {
    vi.mocked(getResearcherResults).mockResolvedValue([]);
    useAuthStore.setState({ status: 'authenticated', user: { id: 'researcher-id', normalizedUsername: 'researcher', displayName: 'Research Lead', createdAt: 1, lastLoginAt: 1 } });
  });

  it('renders all dedicated navigation with the current page marked active', () => {
    render(<MemoryRouter initialEntries={['/researcher/assessments']}><Routes><Route path="researcher" element={<ResearcherLayout />}><Route path="assessments" element={<p>Assessment content</p>} /></Route></Routes></MemoryRouter>);
    const desktop = screen.getByRole('navigation', { name: 'Researcher pages' });
    expect(desktop).toHaveTextContent('DashboardParticipantsAssessmentsLessonsReports');
    expect(desktop.querySelector('a.is-active')).toHaveTextContent('Assessments');
    expect(screen.getByText('Research Lead')).toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mute audio' })).not.toBeInTheDocument();
  });

  it('renders the data loader in a viewport layer outside the sidebar-constrained main column', () => {
    vi.mocked(getResearcherResults).mockReturnValue(new Promise(() => undefined));

    const { container } = render(
      <MemoryRouter initialEntries={['/researcher']}>
        <Routes>
          <Route path="researcher" element={<ResearcherLayout />}>
            <Route index element={<ResearcherDashboardPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const main = container.querySelector('.researcher-main');
    const loading = screen.getByRole('status');
    expect(main).not.toContainElement(loading);
    expect(loading.parentElement).toBe(document.body);
    expect(loading).toHaveClass('loading-state--page', 'researcher-content-loading');
    expect(screen.getByRole('navigation', { name: 'Researcher pages' })).toBeInTheDocument();
  });
});
