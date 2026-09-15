import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminLayout } from './AdminLayout';

describe('Admin workspace navigation', () => {
  it.each(['/admin/users', '/admin/lessons', '/admin/assessments'])(
    'renders the sidebar with the correct active route for %s',
    (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="users" element={<h1>Users page</h1>} />
              <Route path="lessons" element={<h1>Lessons page</h1>} />
              <Route path="assessments" element={<h1>Assessments page</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByRole('navigation', { name: 'Admin navigation' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users');
      expect(screen.getByRole('link', { name: 'Lesson Management' })).toHaveAttribute(
        'href',
        '/admin/lessons',
      );
      expect(screen.getByRole('link', { name: 'Assessment Management' })).toHaveAttribute(
        'href',
        '/admin/assessments',
      );
      expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
      const active = path.endsWith('/users')
        ? 'Users'
        : path.endsWith('/lessons')
          ? 'Lesson Management'
          : 'Assessment Management';
      expect(screen.getByRole('link', { name: active })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByText('Administrator workspace')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    },
  );

  it('keeps an accessible compact navigation in the mobile layout', () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="users" element={<h1>Users page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Admin menu')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Admin menu'));
    expect(
      screen.getByRole('navigation', { name: 'Admin navigation mobile', hidden: true }),
    ).toBeInTheDocument();
  });
});
