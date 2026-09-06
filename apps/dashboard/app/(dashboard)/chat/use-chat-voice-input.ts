'use client';

import { useCallback, useEffect, useState } from 'react';
import { useVoiceSession } from '@/components/voice-session-provider';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { getVoiceHudAnchorRect } from '@/lib/voice/voice-hud-anchor';
import { useRitualVoiceInput } from '@/lib/voice/use-ritual-voice-input';

interface UseChatVoiceInputParams {
  setInput: (value: string) => void;
  textareaRef: { current: HTMLTextAreaElement | null };
}

export function useChatVoiceInput({ setInput, textareaRef }: UseChatVoiceInputParams) {
  const [, setVoiceError] = useState<string | null>(null);
  const { isDesktop } = useDesktopCapabilities();
  const { openVoiceHud, registerVoiceTarget, setLastActiveVoiceTarget } = useVoiceSession();

  const inlineVoiceInput = useRitualVoiceInput({
    setError: setVoiceError,
    setInput,
    textareaRef,
  });

  useEffect(() => {
    return registerVoiceTarget('chat-query', (text) => {
      setInput(text);
      window.setTimeout(() => textareaRef.current?.focus(), 60);
    });
  }, [registerVoiceTarget, setInput, textareaRef]);

  const startVoiceRecognition = useCallback(async () => {
    setVoiceError(null);
    setLastActiveVoiceTarget('chat-query');

    if (!isDesktop) {
      await inlineVoiceInput.startVoiceRecognition();
      return;
    }

    try {
      await openVoiceHud({
        target: 'chat-query',
        source: 'composer',
        anchorRect: getVoiceHudAnchorRect(textareaRef.current),
      });
    } catch (error) {
      console.error('Failed to open voice HUD:', error);
      await inlineVoiceInput.startVoiceRecognition();
    }
  }, [inlineVoiceInput, isDesktop, openVoiceHud, setLastActiveVoiceTarget, textareaRef]);

  return {
    ...inlineVoiceInput,
    startVoiceRecognition,
  };
}
