import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminLayout } from './AdminLayout';

describe('Admin workspace navigation', () => {
  it.each(['/admin/users', '/admin/lessons', '/admin/math-word-list'])(
    'renders the sidebar with the correct active route for %s',
    (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="users" element={<h1>Users page</h1>} />
              <Route path="lessons" element={<h1>Lessons page</h1>} />
              <Route path="math-word-list" element={<h1>Math Word List page</h1>} />
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
      expect(screen.getByRole('link', { name: 'Math Word List' })).toHaveAttribute(
        'href',
        '/admin/math-word-list',
      );
      expect(screen.queryByRole('link', { name: 'Assessment Management' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
      const active = path.endsWith('/users')
        ? 'Users'
        : path.endsWith('/lessons')
          ? 'Lesson Management'
          : 'Math Word List';
      expect(screen.getByRole('link', { name: active })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByText('Administrator workspace')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    },
  );

  it('keeps an accessible compact navigation that closes after choosing a destination', () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="users" element={<h1>Users page</h1>} />
            <Route path="lessons" element={<h1>Lessons page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Admin menu')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Admin menu'));
    expect(
      screen.getByRole('navigation', { name: 'Admin navigation mobile', hidden: true }),
    ).toBeInTheDocument();
    const mobileMenu = document.querySelector<HTMLDetailsElement>('.admin-mobile-nav');
    expect(mobileMenu?.open).toBe(true);
    fireEvent.click(
      document.querySelector<HTMLAnchorElement>(
        '.admin-mobile-nav nav a[href="/admin/lessons"]',
      )!,
    );
    expect(mobileMenu?.open).toBe(false);
  });
});
