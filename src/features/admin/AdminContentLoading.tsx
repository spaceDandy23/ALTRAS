import { createPortal } from 'react-dom';
import { LoadingState } from '@/components/ui/LoadingState';

export function AdminContentLoading({ message }: { message: string }) {
  return createPortal(
    <LoadingState className="admin-content-loading" variant="page" message={message} />,
    document.body,
  );
}
