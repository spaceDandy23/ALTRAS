import { useEffect, useState } from 'react';

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
    >
      <span className="offline-status__dot" aria-hidden="true" />
      You're offline — some features may be unavailable.
    </span>
  );
}
