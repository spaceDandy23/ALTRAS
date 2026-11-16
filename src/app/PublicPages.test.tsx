import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { LandingPage, PrivacyPage } from './PublicPages';

describe('public pages', () => {
  afterEach(() => {
    useAuthStore.setState({ status: 'guest', user: null });
  });

  it('gives visitors the landing content and authentication links', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: 'Math is a language. Learn to translate it.' }),
    ).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Start Learning' })) {
      expect(link).toHaveAttribute('href', '/login');
    }
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '#explore');
    expect(
      screen.getByRole('region', { name: 'Explore ALTRAS' }).querySelector('a, button, input'),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'About ALTRAS' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Learn' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument();
  });

  it('sends an authenticated visitor to the existing protected learning route', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'user-1',
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/home');
    for (const link of screen.getAllByRole('link', { name: 'Start Learning' })) {
      expect(link).toHaveAttribute('href', '/home');
    }
    expect(screen.queryByRole('link', { name: 'Log In' })).not.toBeInTheDocument();
  });

  it('renders during session restoration without retaining the student typography scope', () => {
    useAuthStore.setState({ status: 'loading', user: null });
    document.documentElement.dataset.experience = 'student';
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Math is a language.');
    expect(document.documentElement.dataset.experience).toBe('neutral');
  });

  it('keeps the privacy placeholder public and provides a route home', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: 'Privacy Policy — Coming Soon' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
