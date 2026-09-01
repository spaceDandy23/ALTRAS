import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  it('renders the shared chalk animation with accessible status text', () => {
    render(<LoadingState className="lesson-loading-state" message="Opening lesson…" />);

    const loading = screen.getByRole('status');
    expect(loading).toHaveClass('loading-state', 'lesson-loading-state');
    expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent('Opening lesson…');
    expect(loading.querySelector('.loading-mark')).toHaveAttribute('aria-hidden', 'true');
  });
});
