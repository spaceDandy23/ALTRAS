import type { ComponentProps } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';

export function AdminIconButton({
  icon, label, inSummary, onClick, ...props
}: Omit<ComponentProps<'button'>, 'type' | 'aria-label' | 'title'> & {
  icon: 'up' | 'down' | 'delete';
  label: string;
  inSummary?: boolean;
}) {
  const Icon = icon === 'delete' ? Trash2 : icon === 'up' ? ArrowUp : ArrowDown;
  return (
    <button
      {...props}
      type="button"
      className="admin-icon-button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        if (inSummary) { event.preventDefault(); event.stopPropagation(); }
        onClick?.(event);
      }}
    >
      <Icon size={18} aria-hidden="true" focusable="false" />
    </button>
  );
}
