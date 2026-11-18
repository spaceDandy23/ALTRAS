import type { ReactNode } from 'react';

export function AdminPageHeader({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description: ReactNode;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <p className="researcher-kicker">Administrator workspace</p>
      <h1 id={id}>{title}</h1>
      <p>{description}</p>
      {children}
    </header>
  );
}
