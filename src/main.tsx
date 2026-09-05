import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '@/app/App';
import { primeCachedVisualPreferences } from '@/features/settings/visual-preferences.cache';
import { preloadSfx } from '@/services/audio/audio.manager';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';
import { initializePwaUpdates } from '@/services/pwa-update.service';
import '@/styles/index.css';

applyExperienceScope('neutral');
primeCachedVisualPreferences();
preloadSfx('click');
initializePwaUpdates(registerSW);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
