import { Link } from 'react-router-dom';

export function AltrasLogo({ linked = true, to = '/' }: { linked?: boolean; to?: string }) {
  const mark = (
    <span className="logo" aria-label="ALTRAS">
      <span>ALTRAS</span>
      <small>words → math</small>
    </span>
  );
  return linked ? <Link to={to}>{mark}</Link> : mark;
}
