import stylesheet from '@/styles/index.css?raw';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyVisualPreferences,
  clearVisualPreferences,
} from '@/features/settings/apply-preferences';
import { CharacterAssistant } from './components/CharacterAssistant';

describe('character motion preferences', () => {
  afterEach(() => clearVisualPreferences());

  it('keeps guidance visible while disabling movement immediately', () => {
    applyVisualPreferences({ theme: 'dark', readabilityScale: 1, animationsEnabled: false });
    render(<CharacterAssistant state="greeting" dialogue="Visible without movement." />);

    expect(document.documentElement.dataset.motion).toBe('off');
    expect(screen.getByText('Visible without movement.')).toBeVisible();
    expect(stylesheet).toMatch(
      /:root\[data-motion='off'\] \.character-portrait__motion,[\s\S]*?animation: none !important;/,
    );
  });

  it('contains explicit character overrides for operating-system reduced motion', () => {
    expect(stylesheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.character-portrait__motion,[\s\S]*?animation: none !important;/,
    );
  });

  it('uses responsive portrait sizing for desktop and 320px layouts', () => {
    expect(stylesheet).toMatch(/\.character-portrait \{[\s\S]*?width: clamp\(78px, 6vw, 84px\)/);
    expect(stylesheet).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.character-assistant \.character-portrait \{[\s\S]*?width: clamp\(60px, 19vw, 64px\)/,
    );
    expect(stylesheet).toMatch(/\.character-portrait \{[\s\S]*?aspect-ratio: 3 \/ 4/);
  });
});
