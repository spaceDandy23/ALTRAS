import { useEffect, useRef, useState } from 'react';
import { BackLink } from '@/components/ui/BackLink';
import { Panel } from '@/components/ui/Panel';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { getUserSettings, updateUserSettings, type SettingsUpdate } from './settings.service';
import type { UserSettings } from '@/types/models';

function VolumeControl({
  label,
  value,
  onPreview,
  onCommit,
}: {
  label: string;
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const liveValueRef = useRef(value);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) liveValueRef.current = value;
  }, [value]);

  const commitValue = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    onCommit(liveValueRef.current);
  };

  return (
    <label className="volume-control">
      <span>
        <strong>{label}</strong>
        <output>{value}%</output>
      </span>
      <input
        type="range"
        aria-label={label}
        min="0"
        max="100"
        step="5"
        value={value}
        onChange={(event) => {
          const nextValue = Number(event.target.value);
          liveValueRef.current = nextValue;
          dirtyRef.current = true;
          onPreview(nextValue);
        }}
        onPointerUp={commitValue}
        onPointerCancel={commitValue}
        onKeyUp={commitValue}
        onBlur={commitValue}
      />
    </label>
  );
}

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestSaveRef = useRef(0);

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
    const saveId = ++latestSaveRef.current;
    setSettings((current) => (current ? { ...current, ...update } : current));
    if (typeof update.animationsEnabled === 'boolean') {
      document.documentElement.dataset.motion = update.animationsEnabled ? 'on' : 'off';
    }
    setSaveState('saving');

    const saveOperation = saveQueueRef.current.then(() => updateUserSettings(db, user.id, update));
    saveQueueRef.current = saveOperation.then(
      () => undefined,
      () => undefined,
    );

    try {
      const saved = await saveOperation;
      if (saveId !== latestSaveRef.current) return;
      setSettings(saved);
      setSaveState('saved');
    } catch {
      if (saveId !== latestSaveRef.current) return;
      setSaveState('error');
    }
  };

  const previewSetting = (update: SettingsUpdate) => {
    ++latestSaveRef.current;
    setSaveState('idle');
    setSettings((current) => (current ? { ...current, ...update } : current));
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
            onPreview={(masterVolume) => previewSetting({ masterVolume })}
            onCommit={(masterVolume) => void changeSetting({ masterVolume })}
          />
          <VolumeControl
            label="Sound effects"
            value={settings.soundEffectsVolume}
            onPreview={(soundEffectsVolume) => previewSetting({ soundEffectsVolume })}
            onCommit={(soundEffectsVolume) => void changeSetting({ soundEffectsVolume })}
          />
          <VolumeControl
            label="Music"
            value={settings.musicVolume}
            onPreview={(musicVolume) => previewSetting({ musicVolume })}
            onCommit={(musicVolume) => void changeSetting({ musicVolume })}
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
