import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '@/app/App';
import { primeCachedVisualPreferences } from '@/features/settings/visual-preferences.cache';
import '@/styles/index.css';

primeCachedVisualPreferences();
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
