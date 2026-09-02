import { Button } from './Button';
import { createPortal } from 'react-dom';
import { playSfx } from '@/services/audio/audio.manager';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="dialog__symbol" aria-hidden="true">
          ?
        </span>
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">
          <Button
            variant="quiet"
            onClick={() => {
              playSfx('click');
              onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              playSfx('click');
              onConfirm();
            }}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
