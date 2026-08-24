import { Link } from 'react-router-dom';

export function BackLink({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="back-link" aria-label="Go back">
      <span aria-hidden="true">←</span> Back
    </Link>
  );
}
