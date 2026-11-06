import { Button } from './Button';
import { useId } from 'react';
import { playNeutralClickOnKeyDown, playNeutralClickOnPointerDown } from '@/services/audio/click.handlers';
import { Modal } from './Modal';

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
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      titleId={titleId}
      descriptionId={descriptionId}
      role="alertdialog"
      className="dialog"
    >
        <span className="dialog__symbol" aria-hidden="true">
          ?
        </span>
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId} className="dialog__body">{children}</div>
        <div className="dialog__actions">
          <Button
            variant="quiet"
            onPointerDown={playNeutralClickOnPointerDown}
            onKeyDown={playNeutralClickOnKeyDown}
            onClick={onCancel}
            data-modal-initial-focus
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onPointerDown={playNeutralClickOnPointerDown}
            onKeyDown={playNeutralClickOnKeyDown}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
    </Modal>
  );
}
