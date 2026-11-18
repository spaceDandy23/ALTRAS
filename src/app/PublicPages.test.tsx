import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { LandingPage, PrivacyPage, TermsPage } from './PublicPages';

describe('public pages', () => {
  afterEach(() => useAuthStore.setState({ status: 'guest', user: null }));

  it('gives visitors landing content, legal links, and authentication links', () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(document.querySelector('.public-page')).toHaveClass('public-page');
    expect(screen.getByText('Math is a language.', { selector: 'h1' })).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Start Learning' })) expect(link).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '#explore');
    expect(screen.getByRole('region', { name: 'Explore ALTRAS' }).querySelector('a, button, input')).toBeNull();
    expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Terms' })).toHaveLength(2);
  });

  it('sends an authenticated visitor to the existing protected learning route', () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'user-1', normalizedUsername: 'student', displayName: 'Student', createdAt: 1, lastLoginAt: 1 } });
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/home');
  });

  it('uses the shared loader before showing an unapproved legal page without exposing its draft', async () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading page…');
    expect(await screen.findByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/prepared for researcher approval/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    render(<MemoryRouter><TermsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Terms and Conditions' })).toBeInTheDocument();
  });
});
