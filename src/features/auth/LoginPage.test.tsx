import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { LoginPage } from './LoginPage';
import { resolvePostLoginDestination } from './post-login-route';

const originalLogin = useAuthStore.getState().login;

afterEach(() => {
  useAuthStore.setState({ status: 'guest', user: null, login: originalLogin });
  useResearcherAccessStore.getState().clear();
});

describe('post-login routing', () => {
  it('sends an authorized researcher to researcher results', () => {
    expect(resolvePostLoginDestination('authorized', '/lessons/lesson-one')).toBe(
      '/researcher/results',
    );
  });

  it('sends a normal student to the requested student route', () => {
    expect(resolvePostLoginDestination('denied', '/lessons/lesson-one')).toBe(
      '/lessons/lesson-one',
    );
  });

  it('does not send a student back to a researcher-only route', () => {
    expect(resolvePostLoginDestination('denied', '/researcher/results')).toBe('/');
  });

  it('shows stable loading feedback, disables duplicate submission, and restores after failure', async () => {
    let rejectLogin: (reason: Error) => void = () => undefined;
    const pendingLogin = new Promise<void>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const login = vi.fn(() => pendingLogin);
    useAuthStore.setState({ status: 'guest', user: null, login });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Username'), 'researcher');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const loadingButton = screen.getByRole('button', { name: 'Signing in…' });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');
    expect(loadingButton.querySelector('.loading-spinner')).toBeInTheDocument();
    await user.click(loadingButton);
    expect(login).toHaveBeenCalledTimes(1);

    rejectLogin(new Error('Unable to authenticate this account.'));
    expect(await screen.findByText('Unable to authenticate this account.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-busy', 'false');
  });
});
