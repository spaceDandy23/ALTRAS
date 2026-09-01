export function LoadingState({
  message,
  className = '',
  variant = 'contained',
}: {
  message: string;
  className?: string;
  variant?: 'screen' | 'page' | 'contained';
}) {
  return (
    <div
      className={`loading-state loading-state--${variant} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="loading-mark" aria-hidden="true">
        x + ?
      </div>
      <p>{message}</p>
    </div>
  );
}
