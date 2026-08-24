import { Link } from 'react-router-dom';

export function BackLink({ to = '/', label = 'Back to home' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="back-link">
      <span aria-hidden="true">←</span> {label}
    </Link>
  );
}
