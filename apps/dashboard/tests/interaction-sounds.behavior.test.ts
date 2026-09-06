import { beforeEach, describe, expect, it, vi } from 'vitest';

const { play } = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock('cuelume', () => ({ play }));

import {
  DEFAULT_INTERACTION_SOUND_PREFERENCES,
  playInteractionSound,
  readInteractionSoundPreferences,
  writeInteractionSoundPreferences,
} from '../lib/interaction-sounds';

describe('interaction sound preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    play.mockClear();
  });

  it('migrates the legacy master mute setting', () => {
    window.localStorage.setItem('ritual-interaction-sounds', 'off');

    expect(readInteractionSoundPreferences()).toMatchObject({
      enabled: false,
      volume: DEFAULT_INTERACTION_SOUND_PREFERENCES.volume,
    });
  });

  it('persists volume and per-action cue choices', () => {
    writeInteractionSoundPreferences({
      ...DEFAULT_INTERACTION_SOUND_PREFERENCES,
      volume: 0.43,
      events: {
        ...DEFAULT_INTERACTION_SOUND_PREFERENCES.events,
        taskCompleted: { enabled: false, sound: 'sparkle' },
      },
    });

    expect(readInteractionSoundPreferences()).toMatchObject({
      enabled: true,
      volume: 0.43,
      events: { taskCompleted: { enabled: false, sound: 'sparkle' } },
    });
  });

  it('plays the configured cue only when both master and event settings allow it', () => {
    writeInteractionSoundPreferences({
      ...DEFAULT_INTERACTION_SOUND_PREFERENCES,
      events: {
        ...DEFAULT_INTERACTION_SOUND_PREFERENCES.events,
        habitLogCreated: { enabled: true, sound: 'bloom' },
        taskCompleted: { enabled: false, sound: 'sparkle' },
      },
    });

    playInteractionSound('habitLogCreated');
    playInteractionSound('taskCompleted');

    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith('bloom');
  });
});
