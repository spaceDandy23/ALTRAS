import { beforeEach, describe, expect, it, vi } from 'vitest';

const { howlInstances, MockHowl, MockHowler } = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    unload: ReturnType<typeof vi.fn>;
    volume: ReturnType<typeof vi.fn>;
    playing: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    endHandler: (() => void) | null;
  }> = [];
  class HowlMock {
    options: Record<string, unknown>;
    play = vi.fn(() => 1);
    stop = vi.fn();
    unload = vi.fn();
    volume = vi.fn();
    playing = vi.fn(() => false);
    endHandler: (() => void) | null = null;
    once = vi.fn((event: string, handler: () => void) => {
      if (event === 'end') this.endHandler = handler;
    });

    constructor(options: Record<string, unknown>) {
      this.options = options;
      instances.push(this);
    }
  }
  return {
    howlInstances: instances,
    MockHowl: HowlMock,
    MockHowler: {
      ctx: {
        state: 'running',
        resume: vi.fn(() => Promise.resolve()),
      },
    },
  };
});

vi.mock('howler', () => ({ Howl: MockHowl, Howler: MockHowler }));

import {
  getAudioVolumes,
  playMusic,
  playCompletion,
  playSfx,
  preloadSfx,
  resetAudio,
  setAudioMuted,
  setAudioVolumes,
  stopMusic,
} from './audio.manager';

describe('audio manager', () => {
  beforeEach(() => {
    resetAudio();
    howlInstances.length = 0;
    vi.clearAllMocks();
    MockHowler.ctx.state = 'running';
  });

  it('automatically starts one looping music instance when Howler is already running', () => {
    playMusic('main');
    playMusic('main');

    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0].options).toMatchObject({
      loop: true,
      src: ['/audio/music/main-theme.mp3'],
    });
    expect(howlInstances[0].play).toHaveBeenCalledTimes(1);
  });

  it('starts the existing music instance on the first gesture when the audio context is suspended', () => {
    MockHowler.ctx.state = 'suspended';
    playMusic('main');

    expect(howlInstances[0].play).not.toHaveBeenCalled();
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(howlInstances[0].play).toHaveBeenCalledTimes(1);
    expect(MockHowler.ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('keeps a blocked automatic start pending for the first user gesture', () => {
    playMusic('main');
    const onPlayError = howlInstances[0].options.onplayerror as () => void;
    onPlayError();

    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(howlInstances[0].play).toHaveBeenCalledTimes(2);
    expect(MockHowler.ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('keeps music silent at zero volume and starts it when a saved volume is restored', () => {
    setAudioVolumes({ musicVolume: 0 });
    playMusic('main');

    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0].play).not.toHaveBeenCalled();

    setAudioVolumes({ musicVolume: 60 });
    expect(howlInstances[0].play).toHaveBeenCalledTimes(1);
  });

  it('stops and unloads audio when the session is reset', () => {
    playMusic();
    window.dispatchEvent(new PointerEvent('pointerdown'));
    playSfx('click');

    resetAudio();

    expect(howlInstances[0].stop).toHaveBeenCalled();
    expect(howlInstances[0].unload).toHaveBeenCalled();
    expect(getAudioVolumes()).toEqual({
      masterVolume: 100,
      soundEffectsVolume: 100,
      musicVolume: 100,
    });
  });

  it('applies master and individual music/SFX volumes to active instances', () => {
    playMusic();
    playSfx('click');
    setAudioVolumes({ masterVolume: 80, musicVolume: 50, soundEffectsVolume: 25 });

    expect(howlInstances[0].volume).toHaveBeenLastCalledWith(0.4);
    expect(howlInstances[1].volume).toHaveBeenLastCalledWith(0.2);
  });

  it('does not construct or play effects while SFX output is muted', () => {
    setAudioVolumes({ soundEffectsVolume: 0 });
    playSfx('correct');

    expect(howlInstances).toHaveLength(0);
  });

  it('routes semantic SFX names to manifest assets and reuses each instance', () => {
    playSfx('correct');
    playSfx('correct');
    playSfx('incorrect');

    expect(howlInstances).toHaveLength(2);
    expect(howlInstances[0].options.src).toEqual(['/audio/sfx/correct.wav']);
    expect(howlInstances[1].options.src).toEqual(['/audio/sfx/incorrect.wav']);
    expect(howlInstances[0].play).toHaveBeenCalledTimes(2);
  });

  it('stops music without creating another instance', () => {
    playMusic();
    stopMusic();
    playMusic();

    expect(howlInstances).toHaveLength(1);
  });

  it('preloads and reuses the click sound before the first interaction', () => {
    preloadSfx('click');
    playSfx('click');

    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0].options.src).toEqual(['/audio/sfx/click.wav']);
    expect(howlInstances[0].play).toHaveBeenCalledTimes(1);
  });

  it('temporarily mutes active audio without replacing saved volume levels', () => {
    playMusic();
    playSfx('click');
    setAudioVolumes({ masterVolume: 80, musicVolume: 50, soundEffectsVolume: 25 });
    setAudioMuted(true);

    expect(howlInstances[0].volume).toHaveBeenLastCalledWith(0);
    expect(howlInstances[1].volume).toHaveBeenLastCalledWith(0);
    expect(playSfx('click')).toBeNull();

    setAudioVolumes({ masterVolume: 60 });
    setAudioMuted(false);
    expect(howlInstances[0].volume).toHaveBeenLastCalledWith(0.3);
    expect(howlInstances[1].volume).toHaveBeenLastCalledWith(0.15);
    expect(getAudioVolumes()).toEqual({
      masterVolume: 60,
      musicVolume: 50,
      soundEffectsVolume: 25,
    });
  });

  it('plays a qualifying reward only after its completion sound finishes', () => {
    playCompletion('lesson-attempt-1', true);
    playCompletion('lesson-attempt-1', true);

    expect(howlInstances).toHaveLength(1);
    expect(howlInstances[0].options.src).toEqual(['/audio/sfx/complete.wav']);
    expect(howlInstances[0].play).toHaveBeenCalledTimes(1);
    expect(howlInstances[0].once).toHaveBeenCalledWith('end', expect.any(Function), 1);

    howlInstances[0].endHandler?.();
    expect(howlInstances).toHaveLength(2);
    expect(howlInstances[1].options.src).toEqual(['/audio/sfx/reward.wav']);
    expect(howlInstances[1].play).toHaveBeenCalledTimes(1);
  });
});
