export function LoadingState({
  message,
  className = '',
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={`loading-state ${className}`.trim()}
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
