export function LoadingSpinner({ className = '' }: { className?: string }) {
  return <span className={`loading-spinner ${className}`} aria-hidden="true" />;
}
