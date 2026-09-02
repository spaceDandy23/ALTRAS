import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlgebraicBackdrop } from './AlgebraicBackdrop';

describe('AlgebraicBackdrop', () => {
  it('keeps its algebra marks decorative and theme-aware without becoming interactive content', () => {
    const { container } = render(<AlgebraicBackdrop />);

    const backdrop = container.querySelector('.algebraic-backdrop');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop).toHaveTextContent('x + 5');
    expect(backdrop).toHaveTextContent('2(x + 3)');
    expect(backdrop?.getAttribute('style')).toContain('--algebraic-backdrop-color');
    expect(backdrop?.getAttribute('style')).toContain('--algebraic-backdrop-size');
    expect(backdrop?.getAttribute('style')).toContain('clamp(');
    expect(backdrop?.querySelectorAll('.algebraic-backdrop__equation')).toHaveLength(7);
  });
});
