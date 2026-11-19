import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotStack } from './ScreenshotStack';

const images = [{ source: '/one.webp', alt: 'First screenshot' }, { source: '/two.webp', alt: 'Second screenshot' }, { source: '/three.webp', alt: 'Third screenshot' }];
afterEach(() => vi.unstubAllGlobals());
describe('screenshot stack', () => {
  it('cycles the front image and opens the current screenshot', () => {
    const open = vi.fn();
    render(<ScreenshotStack images={images} label="Learn" onOpen={open} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/one.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Next Learn screenshot' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/two.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Open Learn screenshot' }));
    expect(open).toHaveBeenCalledWith('/two.webp', 'Second screenshot');
    fireEvent.click(screen.getByRole('button', { name: 'Next Learn screenshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next Learn screenshot' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/one.webp');
  });
  it('sends a dragged image to the back without opening the viewer; cancellation keeps the order', () => {
    class Pointer extends MouseEvent {
      pointerId = 1;
      isPrimary = true;
    }
    vi.stubGlobal('PointerEvent', Pointer);
    const open = vi.fn();
    render(<ScreenshotStack images={images} label="Learn" onOpen={open} />);
    const front = screen.getByRole('button', { name: 'Open Learn screenshot' });
    fireEvent.pointerDown(front, { clientX: 100, button: 0 });
    fireEvent.pointerMove(front, { clientX: 170 });
    fireEvent.pointerUp(front, { clientX: 170 });
    fireEvent.click(front, { detail: 1 });
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/two.webp');
    const second = screen.getByRole('button', { name: 'Open Learn screenshot' });
    fireEvent.pointerDown(second, { clientX: 100, button: 0 });
    fireEvent.pointerMove(second, { clientX: 170 });
    fireEvent.pointerCancel(second);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/two.webp');
  });
  it('keeps a single screenshot clickable without next controls', () => {
    render(<ScreenshotStack images={images.slice(0, 1)} label="Learn" onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Next Learn screenshot' })).toBeNull();
  });
});
