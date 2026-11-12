export function AttemptLimitNotice() {
  return (
    <div className="lesson-attempt-limit-notice" role="status">
      <span className="lesson-attempt-limit-notice__icon" aria-hidden="true">!</span>
      <div className="lesson-attempt-limit-notice__content">
        <strong>Attempt limit reached</strong>
        <p>You’ve reached the maximum number of attempts for this lesson.</p>
      </div>
    </div>
  );
}
