import { AlertCircle, Check, X } from 'lucide-react';

export function AdminFeedbackToast({
  kind,
  message,
  onDismiss,
}: {
  kind: 'success' | 'error';
  message: string;
  onDismiss: () => void;
}) {
  const Icon = kind === 'success' ? Check : AlertCircle;
  return (
    <div className={`admin-feedback-toast admin-feedback-toast--${kind}`}>
      <span className="admin-feedback-toast__icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <p role={kind === 'error' ? 'alert' : 'status'}>{message}</p>
      <button
        className="admin-feedback-toast__dismiss"
        type="button"
        aria-label="Dismiss message"
        onClick={onDismiss}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
