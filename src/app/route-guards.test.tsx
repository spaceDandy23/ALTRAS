import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { GuestOnlyRoute, ProtectedRoute } from './route-guards';

describe('route guards', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'guest', user: null });
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
});
