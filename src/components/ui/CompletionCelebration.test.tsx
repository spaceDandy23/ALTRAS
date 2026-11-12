import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionCelebration } from './CompletionCelebration';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  document.documentElement.dataset.motion = 'on';
  vi.unstubAllGlobals();
});

describe('CompletionCelebration', () => {
  it('shows once for a completion event and does not replay on rerender or remount', async () => {
    const eventKey = `activity:${crypto.randomUUID()}`;
    const view = render(<CompletionCelebration eventKey={eventKey} />);
    expect(await screen.findByTestId('completion-celebration')).toBeInTheDocument();
    view.rerender(<CompletionCelebration eventKey={eventKey} />);
    expect(screen.getAllByTestId('completion-celebration')).toHaveLength(1);
    view.unmount();
    render(<CompletionCelebration eventKey={eventKey} />);
    expect(screen.queryByTestId('completion-celebration')).not.toBeInTheDocument();
  });

  it('does not animate when interface animations are disabled', () => {
    document.documentElement.dataset.motion = 'off';
    render(<CompletionCelebration eventKey={`motion-off:${crypto.randomUUID()}`} />);
    expect(screen.queryByTestId('completion-celebration')).not.toBeInTheDocument();
  });

  it('does not animate when the system requests reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<CompletionCelebration eventKey={`reduced:${crypto.randomUUID()}`} />);
    expect(screen.queryByTestId('completion-celebration')).not.toBeInTheDocument();
  });
});
