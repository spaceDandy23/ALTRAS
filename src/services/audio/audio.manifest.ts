export const AUDIO_ASSETS = {
  music: {
    main: '/audio/music/main-theme.mp3',
  },
  sfx: {
    click: '/audio/sfx/click.wav',
    correct: '/audio/sfx/correct.wav',
    incorrect: '/audio/sfx/incorrect.wav',
    complete: '/audio/sfx/complete.wav',
    reward: '/audio/sfx/reward.wav',
  },
} as const;

export type MusicTrack = keyof typeof AUDIO_ASSETS.music;
export type SfxName = keyof typeof AUDIO_ASSETS.sfx;
