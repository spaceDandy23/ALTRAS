import { Button } from './Button';
import { Panel } from './Panel';

export function PageLoadError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Panel className="lesson-error" accent="red">
      <h1>{title}</h1>
      <p role="alert">{message}</p>
      <Button onClick={onRetry}>Try again</Button>
    </Panel>
  );
}
