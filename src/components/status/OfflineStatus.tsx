import { useEffect, useState } from 'react';

const offlineMessage = "You're offline — some features may be unavailable.";

export function OfflineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready; // Initialize service worker silently
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Only show status when offline
  if (online) return null;

  return (
    <span
      className="offline-status offline-status--active"
      role="status"
      aria-live="polite"
      aria-label={offlineMessage}
    >
      <span className="offline-status__dot" aria-hidden="true" />
      <span className="offline-status__message" aria-hidden="true">
        {offlineMessage}
      </span>
    </span>
  );
}
