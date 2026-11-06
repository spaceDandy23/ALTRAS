import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { RegisterPage } from './RegisterPage';

const originalRegister = useAuthStore.getState().register;

afterEach(() => {
  useAuthStore.setState({ status: 'guest', user: null, register: originalRegister });
});

describe('registration password visibility', () => {
  it('independently shows and hides password and confirmation values', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    const password = screen.getByLabelText('Password');
    const confirmation = screen.getByLabelText('Confirm password');
    await user.type(password, 'password1');
    await user.type(confirmation, 'password1');

    const showButtons = screen.getAllByRole('button', { name: 'Show password' });
    await user.click(showButtons[0]);
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('password1');
    expect(confirmation).toHaveAttribute('type', 'password');
    expect(confirmation).toHaveValue('password1');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(confirmation).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveValue('password1');
  });
});
