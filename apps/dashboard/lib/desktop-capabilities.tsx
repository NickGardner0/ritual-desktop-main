'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DesktopRuntimeInfo } from '@/lib/desktop-runtime';
import { isTauri } from '@/lib/tauri-utils';

export type OAuthFlowMode = 'redirect' | 'auto';

export type DesktopCapabilities = {
  isDesktop: boolean;
  /** True once sync + async desktop runtime probes have settled. */
  isReady: boolean;
  canOpenPrivacyPane: boolean;
  oauthFlow: OAuthFlowMode;
  computerActivityFallback: boolean;
  hasNativeAuthBridge: boolean;
  supportsNativeSpeech: boolean;
  supportsNativeVoice: boolean;
  runtimeInfo: DesktopRuntimeInfo | null;
};

function buildSyncCapabilities(): DesktopCapabilities {
  const isDesktop = isTauri();
  return {
    isDesktop,
    isReady: !isDesktop,
    canOpenPrivacyPane: isDesktop,
    oauthFlow: isDesktop ? 'redirect' : 'auto',
    computerActivityFallback: isDesktop,
    hasNativeAuthBridge: false,
    supportsNativeSpeech: isDesktop,
    supportsNativeVoice: isDesktop,
    runtimeInfo: null,
  };
}

let cachedCapabilities: DesktopCapabilities = buildSyncCapabilities();

export function getDesktopCapabilities(): DesktopCapabilities {
  return cachedCapabilities;
}

export function isDesktopRuntime(): boolean {
  return cachedCapabilities.isDesktop;
}

function setCachedCapabilities(next: DesktopCapabilities): void {
  cachedCapabilities = next;
}

const DesktopCapabilitiesContext = createContext<DesktopCapabilities>(cachedCapabilities);

export function useDesktopCapabilities(): DesktopCapabilities {
  return useContext(DesktopCapabilitiesContext);
}

type DesktopCapabilitiesProviderProps = {
  children: ReactNode;
};

export function DesktopCapabilitiesProvider({ children }: DesktopCapabilitiesProviderProps) {
  const [capabilities, setCapabilities] = useState<DesktopCapabilities>(() => buildSyncCapabilities());

  useEffect(() => {
    const sync = buildSyncCapabilities();
    setCachedCapabilities(sync);
    setCapabilities(sync);

    if (!sync.isDesktop) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const { desktopHasCapability, getDesktopRuntimeInfo } = await import('@/lib/desktop-runtime');
        const [runtimeInfo, hasNativeAuthBridge] = await Promise.all([
          getDesktopRuntimeInfo(),
          desktopHasCapability('desktop-auth-handoff-v1'),
        ]);

        if (cancelled) return;

        const next: DesktopCapabilities = {
          ...sync,
          isReady: true,
          hasNativeAuthBridge,
          runtimeInfo,
        };
        setCachedCapabilities(next);
        setCapabilities(next);
      } catch (error) {
        console.warn('Desktop capabilities probe failed:', error);
        if (!cancelled) {
          const next = { ...sync, isReady: true };
          setCachedCapabilities(next);
          setCapabilities(next);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => capabilities, [capabilities]);

  return (
    <DesktopCapabilitiesContext.Provider value={value}>
      {children}
    </DesktopCapabilitiesContext.Provider>
  );
}
