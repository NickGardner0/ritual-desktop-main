'use client';

import { useEffect } from 'react';
import { bind, setEnabled, setVolume } from 'cuelume';

import {
  readInteractionSoundsEnabled,
  subscribeToInteractionSounds,
} from '@/lib/interaction-sounds';

const RITUAL_SOUND_VOLUME = 0.28;

export function InteractionSounds() {
  useEffect(() => {
    bind();
    setVolume(RITUAL_SOUND_VOLUME);
    setEnabled(readInteractionSoundsEnabled());
    return subscribeToInteractionSounds(setEnabled);
  }, []);

  return null;
}
