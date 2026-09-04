import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '@/app/App';
import { primeCachedVisualPreferences } from '@/features/settings/visual-preferences.cache';
import { preloadSfx } from '@/services/audio/audio.manager';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';
import '@/styles/index.css';

applyExperienceScope('neutral');
primeCachedVisualPreferences();
preloadSfx('click');
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
