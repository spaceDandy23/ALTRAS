import { useEffect, useState } from 'react';
import { BackLink } from '@/components/ui/BackLink';
import { Panel } from '@/components/ui/Panel';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { getUserSettings, updateUserSettings, type SettingsUpdate } from './settings.service';
import type { UserSettings } from '@/types/models';

function VolumeControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="volume-control">
      <span>
        <strong>{label}</strong>
        <output>{value}%</output>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!user) return;
    void getUserSettings(db, user.id).then(setSettings);
  }, [user]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timeout = window.setTimeout(() => setSaveState('idle'), 2200);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  if (!user || !settings) {
    return (
      <div className="standard-page">
        <p>Loading settings…</p>
      </div>
    );
  }

  const changeSetting = async (update: SettingsUpdate) => {
    setSettings((current) => (current ? { ...current, ...update } : current));
    if (typeof update.animationsEnabled === 'boolean') {
      document.documentElement.dataset.motion = update.animationsEnabled ? 'on' : 'off';
    }
    setSaveState('saving');
    try {
      const saved = await updateUserSettings(db, user.id, update);
      setSettings(saved);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  return (
    <div className="standard-page page-enter">
      <BackLink />
      <div className="page-heading page-heading--with-status">
        <div>
          <h1>Settings</h1>
          <p>Preferences for {user.displayName} on this device.</p>
        </div>
        <span className={`save-state save-state--${saveState}`} role="status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && '✓ Saved'}
          {saveState === 'error' && 'Could not save'}
        </span>
      </div>
      <div className="settings-grid">
        <Panel className="settings-section" accent="yellow">
          <div className="settings-section__heading">
            <span aria-hidden="true">♫</span>
            <div>
              <h2>Sound</h2>
            </div>
          </div>
          <VolumeControl
            label="Master volume"
            value={settings.masterVolume}
            onChange={(masterVolume) => void changeSetting({ masterVolume })}
          />
          <VolumeControl
            label="Sound effects"
            value={settings.soundEffectsVolume}
            onChange={(soundEffectsVolume) => void changeSetting({ soundEffectsVolume })}
          />
          <VolumeControl
            label="Music"
            value={settings.musicVolume}
            onChange={(musicVolume) => void changeSetting({ musicVolume })}
          />
          <p className="settings-note">
            These preferred volume levels are saved with this account.
          </p>
        </Panel>
        <Panel className="settings-section" accent="red">
          <div className="settings-section__heading">
            <span aria-hidden="true">✦</span>
            <div>
              <h2>Animation</h2>
            </div>
          </div>
          <label className="toggle-row">
            <span>
              <strong>Interface animation</strong>
              <small>Use subtle transitions between screens.</small>
            </span>
            <input
              type="checkbox"
              checked={settings.animationsEnabled}
              onChange={(event) => void changeSetting({ animationsEnabled: event.target.checked })}
            />
            <span className="toggle" aria-hidden="true">
              <span />
            </span>
          </label>
          <p className="settings-note">
            Turning this off removes decorative transitions immediately.
          </p>
        </Panel>
      </div>
    </div>
  );
}
