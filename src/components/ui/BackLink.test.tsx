import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BackLink } from './BackLink';

describe('BackLink', () => {
  it('returns student pages to the student Home route by default', () => {
    render(<MemoryRouter><BackLink /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/home');
  });

  it('keeps explicit destinations for contextual back links', () => {
    render(<MemoryRouter><BackLink to="/lessons" label="Back to lessons" /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Back to lessons' })).toHaveAttribute('href', '/lessons');
  });
});
