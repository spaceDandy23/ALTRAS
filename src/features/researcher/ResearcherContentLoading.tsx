import { createPortal } from 'react-dom';
import { LoadingState } from '@/components/ui/LoadingState';

export function ResearcherContentLoading({ message }: { message: string }) {
  return createPortal(
    <LoadingState
      className="researcher-content-loading"
      variant="page"
      message={message}
    />,
    document.body,
  );
}
