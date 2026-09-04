import { Howl, Howler } from 'howler';
import { AUDIO_ASSETS, type MusicTrack, type SfxName } from './audio.manifest';
import { isStudentExperience } from '@/features/researcher/researcher-experience';

export interface AudioVolumes {
  masterVolume: number;
  soundEffectsVolume: number;
  musicVolume: number;
}

const DEFAULT_VOLUMES: AudioVolumes = {
  masterVolume: 100,
  soundEffectsVolume: 100,
  musicVolume: 100,
};

let volumes = { ...DEFAULT_VOLUMES };
let musicInstance: Howl | null = null;
let activeMusicTrack: MusicTrack | null = null;
let musicRequested = false;
let musicStarted = false;
let musicPlaybackRequested = false;
let gestureListenersAttached = false;
let gestureUnlockAttempted = false;
let muted = false;
const sfxInstances = new Map<SfxName, Howl>();
const failedAssets = new Set<string>();
const completedEvents = new Set<string>();

function normalizedVolume(value: number) {
  return Math.max(0, Math.min(100, value)) / 100;
}

function musicOutputVolume() {
  if (muted) return 0;
  return normalizedVolume(volumes.masterVolume) * normalizedVolume(volumes.musicVolume);
}

function sfxOutputVolume() {
  if (muted) return 0;
  return normalizedVolume(volumes.masterVolume) * normalizedVolume(volumes.soundEffectsVolume);
}

function canUseAudio() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function markAssetFailed(path: string) {
  failedAssets.add(path);
}

function createMusic(track: MusicTrack) {
  const path = AUDIO_ASSETS.music[track];
  if (failedAssets.has(path)) return null;

  return new Howl({
    src: [path],
    loop: true,
    volume: musicOutputVolume(),
    preload: true,
    onloaderror: () => markAssetFailed(path),
    onplay: () => {
      musicStarted = true;
      musicPlaybackRequested = false;
      removeGestureListeners();
    },
    onplayerror: () => {
      musicStarted = false;
      musicPlaybackRequested = false;
      if (!gestureUnlockAttempted && musicRequested) addGestureListeners();
    },
  });
}

function createSfx(name: SfxName) {
  const path = AUDIO_ASSETS.sfx[name];
  if (failedAssets.has(path)) return null;

  return new Howl({
    src: [path],
    volume: sfxOutputVolume(),
    preload: true,
    onloaderror: () => markAssetFailed(path),
  });
}

function getOrCreateSfx(name: SfxName) {
  const instance = sfxInstances.get(name) ?? createSfx(name);
  if (!instance) return null;
  sfxInstances.set(name, instance);
  return instance;
}

function removeGestureListeners() {
  if (!canUseAudio() || !gestureListenersAttached) return;
  window.removeEventListener('pointerdown', unlockFromGesture, true);
  window.removeEventListener('keydown', unlockFromGesture, true);
  window.removeEventListener('touchstart', unlockFromGesture, true);
  gestureListenersAttached = false;
}

function unlockFromGesture() {
  if (gestureUnlockAttempted) return;
  gestureUnlockAttempted = true;
  removeGestureListeners();
  void Howler.ctx?.resume().catch(() => undefined);
  requestMusicPlayback();
}

function addGestureListeners() {
  if (!canUseAudio() || gestureListenersAttached) return;
  window.addEventListener('pointerdown', unlockFromGesture, true);
  window.addEventListener('keydown', unlockFromGesture, true);
  window.addEventListener('touchstart', unlockFromGesture, true);
  gestureListenersAttached = true;
}

function musicCanStartAutomatically() {
  return Howler.ctx?.state !== 'suspended';
}

function requestMusicPlayback() {
  if (
    !musicRequested ||
    !musicInstance ||
    musicStarted ||
    musicPlaybackRequested ||
    musicOutputVolume() === 0
  ) {
    return;
  }

  if (!gestureUnlockAttempted && !musicCanStartAutomatically()) {
    addGestureListeners();
    return;
  }

  try {
    musicPlaybackRequested = true;
    musicInstance.play();
  } catch {
    musicPlaybackRequested = false;
    if (!gestureUnlockAttempted) addGestureListeners();
  }
}

export function setAudioVolumes(next: Partial<AudioVolumes>) {
  volumes = { ...volumes, ...next };
  musicInstance?.volume(musicOutputVolume());
  for (const instance of sfxInstances.values()) instance.volume(sfxOutputVolume());
  requestMusicPlayback();
}

export function setAudioMuted(nextMuted: boolean) {
  muted = nextMuted;
  musicInstance?.volume(musicOutputVolume());
  for (const instance of sfxInstances.values()) instance.volume(sfxOutputVolume());
  if (!nextMuted) requestMusicPlayback();
}

export function getAudioMuted() {
  return muted;
}

export function preloadSfx(...names: SfxName[]) {
  if (!canUseAudio()) return;
  for (const name of names) getOrCreateSfx(name);
}

export function playMusic(track: MusicTrack = 'main') {
  if (!canUseAudio() || !isStudentExperience()) return;
  musicRequested = true;

  if (activeMusicTrack !== track) {
    musicInstance?.stop();
    musicInstance?.unload();
    musicInstance = createMusic(track);
    activeMusicTrack = track;
    musicStarted = false;
    musicPlaybackRequested = false;
    gestureUnlockAttempted = false;
  }

  if (!musicInstance) return;
  requestMusicPlayback();
  if (musicOutputVolume() > 0 && !musicStarted && !musicPlaybackRequested) addGestureListeners();
}

export function stopMusic() {
  musicInstance?.stop();
  musicStarted = false;
  musicPlaybackRequested = false;
  musicRequested = false;
  gestureUnlockAttempted = false;
  removeGestureListeners();
}

export function playSfx(name: SfxName): number | null {
  if (!canUseAudio() || !isStudentExperience() || sfxOutputVolume() === 0) return null;
  const instance = getOrCreateSfx(name);
  if (!instance) return null;

  try {
    instance.volume(sfxOutputVolume());
    return instance.play();
  } catch {
    // Audio is optional. A blocked or unsupported file must not affect the app.
    return null;
  }
}

export function playCompletion(eventId: string, withReward: boolean) {
  if (!isStudentExperience()) return;
  if (completedEvents.has(eventId)) return;
  completedEvents.add(eventId);

  const completionSoundId = playSfx('complete');
  if (!withReward || completionSoundId === null) return;
  const completionSound = sfxInstances.get('complete');
  completionSound?.once(
    'end',
    () => {
      playSfx('reward');
    },
    completionSoundId,
  );
}

export function resetAudio() {
  stopMusic();
  musicInstance?.unload();
  musicInstance = null;
  activeMusicTrack = null;
  for (const instance of sfxInstances.values()) instance.unload();
  sfxInstances.clear();
  volumes = { ...DEFAULT_VOLUMES };
  muted = false;
  completedEvents.clear();
}

export function getAudioVolumes(): AudioVolumes {
  return { ...volumes };
}
