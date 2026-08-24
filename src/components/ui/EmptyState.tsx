import type { ReactNode } from 'react';
import { Panel } from './Panel';

export function EmptyState({
  symbol,
  title,
  children,
}: {
  symbol: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Panel className="empty-state">
      <span className="empty-state__symbol" aria-hidden="true">
        {symbol}
      </span>
      <p className="eyebrow">Coming next</p>
      <h1>{title}</h1>
      <div className="empty-state__copy">{children}</div>
    </Panel>
  );
}
