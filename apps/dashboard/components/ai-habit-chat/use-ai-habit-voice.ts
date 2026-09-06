import { useCallback, useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useVoiceSession } from '@/components/voice-session-provider';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { getVoiceHudAnchorRect } from '@/lib/voice/voice-hud-anchor';
import { useRitualVoiceInput } from '@/lib/voice/use-ritual-voice-input';
import { normalizeLoggerVoiceTranscript } from './local-log-parser';

export type UseAiHabitVoiceOptions = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setInput: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useAiHabitVoice({ textareaRef, setInput, setError }: UseAiHabitVoiceOptions) {
  const { isDesktop } = useDesktopCapabilities();
  const { openVoiceHud, registerVoiceTarget, setLastActiveVoiceTarget } = useVoiceSession();
  const inlineVoiceInput = useRitualVoiceInput({
    nativeAutoStopMs: 15000,
    normalizeTranscript: normalizeLoggerVoiceTranscript,
    setError,
    setInput,
    textareaRef,
  });

  useEffect(() => {
    return registerVoiceTarget('habit-log', (text) => {
      setInput(text);
      window.setTimeout(() => textareaRef.current?.focus(), 60);
    });
  }, [registerVoiceTarget, setInput, textareaRef]);

  const startVoiceRecognition = useCallback(async () => {
    setError(null);
    setLastActiveVoiceTarget('habit-log');

    if (!isDesktop) {
      await inlineVoiceInput.startVoiceRecognition();
      return;
    }

    try {
      await openVoiceHud({
        target: 'habit-log',
        source: 'composer',
        anchorRect: getVoiceHudAnchorRect(textareaRef.current),
      });
    } catch (error) {
      console.error('Failed to open voice HUD:', error);
      await inlineVoiceInput.startVoiceRecognition();
    }
  }, [inlineVoiceInput, isDesktop, openVoiceHud, setError, setLastActiveVoiceTarget, textareaRef]);

  return {
    ...inlineVoiceInput,
    startVoiceRecognition,
  };
}
