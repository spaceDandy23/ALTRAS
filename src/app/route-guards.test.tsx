import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import {
  GuestOnlyRoute,
  ProtectedRoute,
  ResolvedExperienceRoute,
  StudentRoute,
} from './route-guards';

const user = {
  id: '00000000-0000-0000-0000-000000000001',
  normalizedUsername: 'account_test',
  displayName: 'Account Test',
  createdAt: 1,
  lastLoginAt: 1,
};
const originalCheckAccess = useResearcherAccessStore.getState().checkAccess;

describe('route guards', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'guest', user: null });
    useResearcherAccessStore.setState({
      status: 'idle',
      userId: null,
      checkAccess: originalCheckAccess,
    });
  });

  afterEach(() => {
    delete document.documentElement.dataset.experience;
    document.documentElement.style.removeProperty('--readability-scale');
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

  it('renders an accessible centered loader while authentication is loading', () => {
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
    expect(loading.querySelector('p')).not.toBeInTheDocument();
    expect(screen.queryByText('Private content')).not.toBeInTheDocument();
  });

  it('keeps the login form hidden while guest authentication is unresolved', () => {
    useAuthStore.setState({ status: 'loading', user: null });
    document.documentElement.dataset.experience = 'student';
    document.documentElement.style.setProperty('--readability-scale', '1.3');

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
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

    const loading = screen.getByRole('status');
    expect(loading).toHaveClass('loading-state--screen');
    expect(loading.querySelector('p')).not.toBeInTheDocument();
    expect(loading).not.toHaveTextContent('Checking sign in status');
    expect(loading).not.toHaveTextContent('Checking sign in state');
    expect(loading).not.toHaveTextContent('Opening your classroom…');
    expect(screen.queryByText('Login form')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.experience).toBe('neutral');
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
  });

  it.each(['/login', '/register'])(
    'forces the %s guest page into neutral typography scope',
    (path) => {
      document.documentElement.dataset.experience = 'student';
      document.documentElement.style.setProperty('--readability-scale', '1.3');

      render(
        <MemoryRouter initialEntries={[path]}>
          <GuestOnlyRoute>
            <p>Authentication form</p>
          </GuestOnlyRoute>
        </MemoryRouter>,
      );

      expect(screen.getByText('Authentication form')).toBeInTheDocument();
      expect(document.documentElement.dataset.experience).toBe('neutral');
      expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
    },
  );

  it('does not mount an application shell while session restoration is unresolved', () => {
    useAuthStore.setState({ status: 'loading', user: null });

    const { container } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
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

    expect(container.querySelector('.app-shell')).not.toBeInTheDocument();
    expect(container.querySelector('.app-header')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('loading-state--screen');
    expect(screen.queryByText('Private settings')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    '/researcher',
    '/researcher/participants',
    '/researcher/assessments',
    '/researcher/lessons',
    '/researcher/reports',
  ])('keeps %s neutral until researcher access resolves', (path) => {
    useAuthStore.setState({ status: 'authenticated', user });
    useResearcherAccessStore.setState({
      status: 'loading',
      userId: user.id,
      checkAccess: vi.fn(() => new Promise<void>(() => undefined)),
    });
    document.documentElement.dataset.experience = 'student';
    document.documentElement.style.setProperty('--readability-scale', '1.3');

    render(
      <MemoryRouter initialEntries={[path]}>
        <ResolvedExperienceRoute>
          <div className="app-shell" data-testid="resolved-shell">
            Resolved application shell
          </div>
        </ResolvedExperienceRoute>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveClass('loading-state--screen');
    expect(screen.queryByTestId('resolved-shell')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.experience).toBe('neutral');
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');

    act(() => useResearcherAccessStore.setState({ status: 'authorized', userId: user.id }));

    expect(screen.getByTestId('resolved-shell')).toBeInTheDocument();
    expect(document.documentElement.dataset.experience).toBe('researcher');
  });

  it('mounts the student shell only after student access resolves', () => {
    useAuthStore.setState({ status: 'authenticated', user });
    useResearcherAccessStore.setState({
      status: 'loading',
      userId: user.id,
      checkAccess: vi.fn(() => new Promise<void>(() => undefined)),
    });
    document.documentElement.style.setProperty('--readability-scale', '1.3');

    render(
      <MemoryRouter>
        <ResolvedExperienceRoute>
          <div data-testid="student-shell">Student shell</div>
        </ResolvedExperienceRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('student-shell')).not.toBeInTheDocument();

    act(() => useResearcherAccessStore.setState({ status: 'denied', userId: user.id }));

    expect(screen.getByTestId('student-shell')).toBeInTheDocument();
    expect(document.documentElement.dataset.experience).toBe('student');
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
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
          <Route path="/researcher" element={<p>Researcher results destination</p>} />
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
