import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenPage(): never {
  throw new Error('render failed');
}

describe('AppErrorBoundary', () => {
  it('replaces an unexpected page render failure with a recoverable fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <BrokenPage />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload ALTRAS' })).toBeVisible();

    vi.restoreAllMocks();
  });
});
