import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface LessonTransitionOptions {
  loadingMessage: string;
  run: () => Promise<string>;
  fallbackError: string;
}

export function useLessonTransition() {
  const navigate = useNavigate();
  const inFlightRef = useRef(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState('');

  const startTransition = useCallback(
    async ({ loadingMessage: message, run, fallbackError }: LessonTransitionOptions) => {
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      setTransitionError('');
      setLoadingMessage(message);

      try {
        navigate(await run());
      } catch (cause) {
        inFlightRef.current = false;
        setLoadingMessage(null);
        setTransitionError(cause instanceof Error ? cause.message : fallbackError);
      }
    },
    [navigate],
  );

  return {
    loadingMessage,
    transitionError,
    transitionBusy: loadingMessage !== null,
    startTransition,
  };
}
