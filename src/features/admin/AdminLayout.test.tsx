import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AdminLayout } from './AdminLayout';

describe('Admin workspace navigation', () => {
  it.each(['/admin/users', '/admin/lessons'])(
    'links Users and Lesson Management from %s',
    (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="users" element={<h1>Users page</h1>} />
              <Route path="lessons" element={<h1>Lessons page</h1>} />
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
    },
  );
});
