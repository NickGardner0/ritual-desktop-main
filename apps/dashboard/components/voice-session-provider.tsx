'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { openDesktopVoiceHud } from '@/lib/native-gateway';
import {
  VOICE_EVENTS,
  type VoiceHotkeyOpenPayload,
  type VoiceHudAnchorRect,
  type VoiceSessionCancelledPayload,
  type VoiceSessionFinalPayload,
  type VoiceSessionSource,
  type VoiceTarget,
} from '@/lib/voice/voice-session-contract';

type VoiceTargetHandler = (text: string) => void;

type OpenVoiceHudOptions = {
  target: VoiceTarget;
  source?: VoiceSessionSource;
  anchorRect?: VoiceHudAnchorRect;
};

type VoiceSessionContextValue = {
  openVoiceHud: (options: OpenVoiceHudOptions) => Promise<boolean>;
  registerVoiceTarget: (target: VoiceTarget, handler: VoiceTargetHandler) => () => void;
  setLastActiveVoiceTarget: (target: VoiceTarget) => void;
};

const PENDING_VOICE_FINAL_KEY = 'ritual:pending-voice-final:v1';

const VoiceSessionContext = createContext<VoiceSessionContextValue>({
  openVoiceHud: async () => false,
  registerVoiceTarget: () => () => undefined,
  setLastActiveVoiceTarget: () => undefined,
});

function getFallbackTargetForPath(pathname: string | null): VoiceTarget {
  return pathname === '/chat' ? 'chat-query' : 'habit-log';
}

function storePendingVoiceFinal(payload: VoiceSessionFinalPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_VOICE_FINAL_KEY, JSON.stringify(payload));
  } catch {
    // Best effort only. If storage is unavailable, the event simply drops.
  }
}

function takePendingVoiceFinal(target: VoiceTarget): VoiceSessionFinalPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_VOICE_FINAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VoiceSessionFinalPayload;
    if (parsed?.target !== target || typeof parsed.text !== 'string') {
      return null;
    }
    window.sessionStorage.removeItem(PENDING_VOICE_FINAL_KEY);
    return parsed;
  } catch {
    window.sessionStorage.removeItem(PENDING_VOICE_FINAL_KEY);
    return null;
  }
}

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const { isDesktop } = useDesktopCapabilities();
  const pathname = usePathname();
  const router = useRouter();
  const handlersRef = useRef<Map<VoiceTarget, VoiceTargetHandler>>(new Map());
  const lastActiveTargetRef = useRef<VoiceTarget>(getFallbackTargetForPath(pathname));

  useEffect(() => {
    const fallbackTarget = getFallbackTargetForPath(pathname);
    if (!handlersRef.current.has(lastActiveTargetRef.current)) {
      lastActiveTargetRef.current = fallbackTarget;
    }
  }, [pathname]);

  const setLastActiveVoiceTarget = useCallback((target: VoiceTarget) => {
    lastActiveTargetRef.current = target;
  }, []);

  const deliverFinal = useCallback((payload: VoiceSessionFinalPayload) => {
    const handler = handlersRef.current.get(payload.target);
    if (handler) {
      lastActiveTargetRef.current = payload.target;
      handler(payload.text);
      return;
    }

    storePendingVoiceFinal(payload);
    if (payload.target === 'chat-query') {
      router.push('/chat');
    } else {
      router.push('/dashboard');
    }
  }, [router]);

  const openVoiceHud = useCallback(
    async ({ target, source = 'composer', anchorRect }: OpenVoiceHudOptions) => {
      lastActiveTargetRef.current = target;
      if (!isDesktop) {
        return false;
      }

      await openDesktopVoiceHud({
        target,
        source,
        submitOnFinal: false,
        anchorRect,
      });
      return true;
    },
    [isDesktop],
  );

  const registerVoiceTarget = useCallback(
    (target: VoiceTarget, handler: VoiceTargetHandler) => {
      handlersRef.current.set(target, handler);
      lastActiveTargetRef.current = target;

      const pending = takePendingVoiceFinal(target);
      if (pending) {
        queueMicrotask(() => handler(pending.text));
      }

      return () => {
        if (handlersRef.current.get(target) === handler) {
          handlersRef.current.delete(target);
        }
      };
    },
    [],
  );

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    let unlisteners: Array<() => void> = [];

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const finalUnlisten = await listen<VoiceSessionFinalPayload>(VOICE_EVENTS.final, (event) => {
        deliverFinal(event.payload);
      });
      const cancelledUnlisten = await listen<VoiceSessionCancelledPayload>(VOICE_EVENTS.cancelled, (event) => {
        lastActiveTargetRef.current = event.payload.target;
      });
      const hotkeyUnlisten = await listen<VoiceHotkeyOpenPayload>(VOICE_EVENTS.hotkeyOpen, () => {
        const target = lastActiveTargetRef.current || getFallbackTargetForPath(pathname);
        void openVoiceHud({ target, source: 'hotkey' });
      });

      if (cancelled) {
        finalUnlisten();
        cancelledUnlisten();
        hotkeyUnlisten();
        return;
      }

      unlisteners = [finalUnlisten, cancelledUnlisten, hotkeyUnlisten];
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      unlisteners = [];
    };
  }, [deliverFinal, isDesktop, openVoiceHud, pathname]);

  const value = useMemo<VoiceSessionContextValue>(
    () => ({
      openVoiceHud,
      registerVoiceTarget,
      setLastActiveVoiceTarget,
    }),
    [openVoiceHud, registerVoiceTarget, setLastActiveVoiceTarget],
  );

  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSession() {
  return useContext(VoiceSessionContext);
}
