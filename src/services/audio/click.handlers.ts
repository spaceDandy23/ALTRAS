import type { KeyboardEvent, PointerEvent } from 'react';
import { playSfx } from './audio.manager';

export function playNeutralClickOnPointerDown(event: PointerEvent<HTMLElement>) {
  if (event.button === 0) playSfx('click');
}

export function playNeutralClickOnKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) playSfx('click');
}
