import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

const pieces = [
  ['-150px', '-116px', 0],
  ['-126px', '-82px', 55],
  ['-102px', '-134px', 110],
  ['-78px', '-42px', 25],
  ['-54px', '-96px', 95],
  ['-30px', '-58px', 145],
  ['-6px', '-122px', 45],
  ['18px', '48px', 120],
  ['42px', '102px', 10],
  ['66px', '62px', 75],
  ['90px', '132px', 135],
  ['114px', '84px', 35],
  ['138px', '158px', 105],
] as const;

const celebratedEvents = new Set<string>();

function motionIsReduced() {
  return (
    document.documentElement.dataset.motion === 'off' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export function CompletionCelebration({ eventKey }: { eventKey: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const key = `altras:completion-celebration:${eventKey}`;
    if (celebratedEvents.has(key) || motionIsReduced()) return;
    try {
      if (window.sessionStorage.getItem(key)) {
        celebratedEvents.add(key);
        return;
      }
      window.sessionStorage.setItem(key, 'shown');
    } catch {
      // The in-memory guard still prevents repeats when session storage is unavailable.
    }
    celebratedEvents.add(key);
    setVisible(true);
  }, [eventKey]);

  if (!visible) return null;
  return (
    <span className="completion-celebration" data-testid="completion-celebration" aria-hidden="true">
      {pieces.map(([from, to, delay], index) => (
        <span
          className="completion-celebration__piece"
          key={index}
          style={{
            '--celebration-from': from,
            '--celebration-to': to,
            '--celebration-delay': `${delay}ms`,
          } as CSSProperties}
        />
      ))}
    </span>
  );
}
