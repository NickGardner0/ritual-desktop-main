'use client';

import { useEffect } from 'react';
import { bind, setEnabled, setVolume } from 'cuelume';
import {
  readInteractionSoundPreferences,
  subscribeToInteractionSoundPreferences,
} from '@/lib/interaction-sounds';

export default function InteractionSoundsRuntime() {
  useEffect(() => {
    bind();
    const applyPreferences = (preferences: ReturnType<typeof readInteractionSoundPreferences>) => {
      setVolume(preferences.volume);
      setEnabled(preferences.enabled);
    };
    applyPreferences(readInteractionSoundPreferences());
    return subscribeToInteractionSoundPreferences(applyPreferences);
  }, []);

  return null;
}
