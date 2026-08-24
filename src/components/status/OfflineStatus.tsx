import { useEffect, useState } from 'react';

export function OfflineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then(() => setOfflineReady(true));
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <span
      className={`offline-status ${online && offlineReady ? '' : 'offline-status--active'}`}
      role="status"
    >
      <span className="offline-status__dot" aria-hidden="true" />
      {!online ? 'Working offline' : offlineReady ? 'Offline ready' : 'Preparing offline'}
    </span>
  );
}
