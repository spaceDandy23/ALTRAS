import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ProtectedRoute } from '@/app/route-guards';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { ResearcherRoute } from './ResearcherRoute';

const styles = readFileSync(resolve('src/styles/index.css'), 'utf8');

const user = {
  id: '00000000-0000-0000-0000-000000000001',
  normalizedUsername: 'research_test',
  displayName: 'Research Test',
  createdAt: 1,
  lastLoginAt: 1,
};

describe('researcher route protection', () => {
  afterEach(() => {
    useAuthStore.setState({ status: 'guest', user: null });
    useResearcherAccessStore.setState({ status: 'idle', userId: null });
  });

  it('redirects an unauthenticated direct route visit to sign in', () => {
    useAuthStore.setState({ status: 'guest', user: null });
    render(
      <MemoryRouter initialEntries={['/researcher/results']}>
        <Routes>
          <Route path="/login" element={<p>Sign in destination</p>} />
          <Route
            path="/researcher/results"
            element={
              <ProtectedRoute>
                <ResearcherRoute>
                  <p>Protected participant data</p>
                </ResearcherRoute>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Sign in destination')).toBeInTheDocument();
    expect(screen.queryByText('Protected participant data')).not.toBeInTheDocument();
    expect(document.querySelector('[data-character-id]')).not.toBeInTheDocument();
  });

  it('shows a denied state and never mounts protected data for students', () => {
    useAuthStore.setState({ status: 'authenticated', user });
    useResearcherAccessStore.setState({ status: 'denied', userId: user.id });
    render(
      <MemoryRouter>
        <ResearcherRoute>
          <p>Protected participant data</p>
        </ResearcherRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText('Researcher access required')).toBeInTheDocument();
    expect(document.querySelector('.researcher-access-state')).toBeInTheDocument();
    expect(document.querySelector('.researcher-access-state > .researcher-state')).toBeInTheDocument();
    expect(screen.queryByText('Protected participant data')).not.toBeInTheDocument();
    expect(document.querySelector('[data-character-id]')).not.toBeInTheDocument();
  });

  it('mounts results only after researcher authorization succeeds', () => {
    useAuthStore.setState({ status: 'authenticated', user });
    useResearcherAccessStore.setState({ status: 'authorized', userId: user.id });
    render(
      <MemoryRouter>
        <ResearcherRoute>
          <p>Protected participant data</p>
        </ResearcherRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText('Protected participant data')).toBeInTheDocument();
    expect(document.querySelector('[data-character-id]')).not.toBeInTheDocument();
  });

  it('defines a viewport-centered access state with mobile edge spacing', () => {
    expect(styles).toMatch(
      /\.researcher-access-state \{[\s\S]*?min-height: 100svh;[\s\S]*?place-items: center;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 480px\) \{[\s\S]*?\.researcher-access-state \{[\s\S]*?padding: 0\.75rem;/,
    );
  });
});
