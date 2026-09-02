import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlgebraicBackdrop } from './AlgebraicBackdrop';

describe('AlgebraicBackdrop', () => {
  it('keeps its algebra marks decorative without inline presentation overrides', () => {
    const { container } = render(<AlgebraicBackdrop />);

    const backdrop = container.querySelector('.algebraic-backdrop');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(backdrop).toHaveTextContent('x + 5');
    expect(backdrop).toHaveTextContent('2(x + 3)');
    expect(backdrop).not.toHaveAttribute('style');
    expect(backdrop?.querySelectorAll('.algebraic-backdrop__equation')).toHaveLength(7);
  });
});
