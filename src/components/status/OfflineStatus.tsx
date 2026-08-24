import { useEffect, useState } from 'react';

export function OfflineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [showReady, setShowReady] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then(() => {
        setOfflineReady(true);
        setShowReady(true);
      });
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!showReady) return;
    const timeout = window.setTimeout(() => setShowReady(false), 3200);
    return () => window.clearTimeout(timeout);
  }, [showReady]);

  if (online && offlineReady && !showReady) return null;

  return (
    <span
      className={`offline-status ${online && offlineReady ? 'offline-status--ready' : 'offline-status--active'}`}
      role="status"
      aria-live="polite"
    >
      <span className="offline-status__dot" aria-hidden="true" />
      {!online ? 'Working offline' : offlineReady ? 'Offline ready' : 'Preparing offline'}
    </span>
  );
}
