import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
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
    expect(screen.getAllByText('Research Lead')).toHaveLength(2);
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

  it('exposes the existing logout confirmation from mobile navigation', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/researcher']}><Routes><Route path="researcher" element={<ResearcherLayout />}><Route index element={<p>Dashboard</p>} /></Route></Routes></MemoryRouter>);

    const mobileNavigation = screen.getByRole('navigation', { name: 'Researcher pages mobile' });
    const mobileLogout = mobileNavigation.parentElement?.querySelector('button');
    expect(mobileLogout).toHaveTextContent('Log out');
    await user.click(mobileLogout as HTMLButtonElement);
    expect(screen.getByRole('alertdialog', { name: 'Leave the research workspace?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
