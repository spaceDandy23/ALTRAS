import type { HTMLAttributes, ReactNode } from 'react';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: 'section' | 'article' | 'div';
  accent?: 'yellow' | 'blue' | 'red' | 'none';
}

export function Panel({
  children,
  as: Component = 'section',
  accent = 'none',
  className = '',
  ...props
}: PanelProps) {
  return (
    <Component className={`panel panel--${accent} ${className}`} {...props}>
      {children}
    </Component>
  );
}
