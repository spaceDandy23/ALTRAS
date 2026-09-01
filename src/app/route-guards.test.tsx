import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { GuestOnlyRoute, ProtectedRoute, StudentRoute } from './route-guards';

const user = {
  id: '00000000-0000-0000-0000-000000000001',
  normalizedUsername: 'account_test',
  displayName: 'Account Test',
  createdAt: 1,
  lastLoginAt: 1,
};

describe('route guards', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'guest', user: null });
    useResearcherAccessStore.setState({ status: 'idle', userId: null });
  });

  it('redirects a guest away from an authenticated route', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/login" element={<p>Login destination</p>} />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <p>Private settings</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Login destination')).toBeInTheDocument();
    expect(screen.queryByText('Private settings')).not.toBeInTheDocument();
  });

  it('renders an accessible full transition state while authentication is loading', () => {
    useAuthStore.setState({ status: 'loading', user: null });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <p>Private content</p>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    const loading = screen.getByRole('status');
    expect(loading).toHaveClass('loading-state--screen');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent('Opening your classroom…');
    expect(screen.queryByText('Private content')).not.toBeInTheDocument();
  });

  it('redirects an authenticated student away from login', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: crypto.randomUUID(),
        normalizedUsername: 'learner',
        displayName: 'Learner',
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      },
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/" element={<p>Main menu destination</p>} />
          <Route
            path="/login"
            element={
              <GuestOnlyRoute>
                <p>Login form</p>
              </GuestOnlyRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Main menu destination')).toBeInTheDocument();
    expect(screen.queryByText('Login form')).not.toBeInTheDocument();
  });

  it('protects the Word list route for signed-out visitors', () => {
    render(
      <MemoryRouter initialEntries={['/lessons/almanac/word-list']}>
        <Routes>
          <Route path="/login" element={<p>Word list login destination</p>} />
          <Route
            path="/lessons/almanac/word-list"
            element={
              <ProtectedRoute>
                <p>Private Math word list</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Word list login destination')).toBeInTheDocument();
    expect(screen.queryByText('Private Math word list')).not.toBeInTheDocument();
  });

  it('redirects an authorized researcher away from a direct lesson route', () => {
    useAuthStore.setState({ status: 'authenticated', user });
    useResearcherAccessStore.setState({ status: 'authorized', userId: user.id });

    render(
      <MemoryRouter initialEntries={['/lessons/lesson-one']}>
        <Routes>
          <Route path="/researcher/results" element={<p>Researcher results destination</p>} />
          <Route
            path="/lessons/:lessonId"
            element={
              <StudentRoute>
                <p>Student lesson activity</p>
              </StudentRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Researcher results destination')).toBeInTheDocument();
    expect(screen.queryByText('Student lesson activity')).not.toBeInTheDocument();
  });

  it('keeps normal students in the student application', () => {
    useAuthStore.setState({ status: 'authenticated', user });
    useResearcherAccessStore.setState({ status: 'denied', userId: user.id });

    render(
      <MemoryRouter>
        <StudentRoute>
          <p>Student application</p>
        </StudentRoute>
      </MemoryRouter>,
    );

    expect(screen.getByText('Student application')).toBeInTheDocument();
  });
});
