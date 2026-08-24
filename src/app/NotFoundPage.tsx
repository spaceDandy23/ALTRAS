import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="not-found">
      <div className="not-found__equation" aria-hidden="true">
        4 + 0 = 4<span>?</span>
      </div>
      <p className="eyebrow">404 · Page not found</p>
      <h1>Page not found</h1>
      <p>The page may have moved, or the address might need another look.</p>
      <Link to="/" className="button button--primary">
        Return to ALTRAS
      </Link>
    </main>
  );
}
