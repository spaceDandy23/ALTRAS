import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { RegisterPage } from './RegisterPage';

const originalRegister = useAuthStore.getState().register;

afterEach(() => {
  useAuthStore.setState({ status: 'guest', user: null, register: originalRegister });
});

describe('registration password visibility', () => {
  it('links applicants to the public privacy and terms pages without requiring acceptance', () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy-policy');
    expect(screen.getByRole('link', { name: 'Terms and Conditions' })).toHaveAttribute('href', '/terms-and-conditions');
  });

  it('opens the student Home route after successful registration', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ register: vi.fn().mockResolvedValue(undefined) });
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/home" element={<p>Student Home destination</p>} />
          <Route path="/" element={<p>Public landing destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Display name'), 'Student');
    await user.type(screen.getByLabelText('Username'), 'student1');
    await user.type(screen.getByLabelText('Password'), 'password1');
    await user.type(screen.getByLabelText('Confirm password'), 'password1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Student Home destination')).toBeInTheDocument();
    expect(screen.queryByText('Public landing destination')).not.toBeInTheDocument();
  });

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
