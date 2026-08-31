'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@clerk/nextjs';

import {
  desktopCompleteAuthHandoff,
  desktopGetAuthToken,
  getDesktopRuntimeInfo,
  recordDesktopShellEvent,
} from '@/lib/native-gateway';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  consumeDesktopAuthHandoff,
  storePendingDesktopAuthAcknowledgement,
} from '@/lib/desktop-auth-handoff';
import {
  clearFromWelcomeFlow,
  clearSignUpIntent,
  markDeviceAuthenticated,
} from '@/lib/onboarding-flow';
import { initializeDesktopVault } from '@/lib/privacy/vault-client';

const DESKTOP_AUTH_DEEP_LINK_EVENT = 'desktop://auth-deep-link';

async function completeDesktopAuthDeepLink(rawUrl: string): Promise<string> {
  const parsed = new URL(rawUrl);
  const runtimeInfo = await getDesktopRuntimeInfo();
  if (!runtimeInfo) throw new Error('Desktop runtime identity is unavailable.');
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const handoffProtocol = parsed.searchParams.get('protocol');
  const legacyV1 = !handoffProtocol
    && runtimeInfo.channel === 'production'
    && runtimeInfo.capabilities.includes('desktop-auth-handoff-v1');

  if (
    scheme !== runtimeInfo.callbackScheme.toLowerCase()
    && !(legacyV1 && scheme === 'ritual')
  ) {
    throw new Error(`Unsupported desktop auth protocol: ${parsed.protocol}`);
  }

  const ticket = parsed.searchParams.get('ticket')?.trim() || '';
  if (legacyV1) {
    if (!ticket) throw new Error('Legacy desktop authentication callback is missing its ticket.');
    throw new Error('Legacy desktop authentication tickets cannot sign in the local SPA.');
  }

  const handoffId = parsed.searchParams.get('handoff_id')?.trim() || '';
  const nonce = parsed.searchParams.get('nonce')?.trim() || '';
  const channel = parsed.searchParams.get('channel');
  if (
    !handoffId || !nonce || ticket || handoffProtocol !== '2'
    || channel !== runtimeInfo.channel
    || runtimeInfo.handoffProtocol !== '2'
  ) {
    throw new Error('Desktop authentication handoff identity does not match this app.');
  }
  await consumeDesktopAuthHandoff({
    handoffId,
    nonce,
    channel: runtimeInfo.channel,
    protocol: '2',
    runtimeInfo,
  });
  await desktopCompleteAuthHandoff(handoffId);
  storePendingDesktopAuthAcknowledgement(handoffId);
  return '/dashboard';
}

export function DesktopAuthDeepLinkBridge() {
  const { isDesktop } = useDesktopCapabilities();
  const { getToken } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (
        params.get('ritual_sidebar_window') === '1'
        || params.get('ritual_settings_window') === '1'
      ) {
        return;
      }
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const handleDesktopDeepLink = async (rawUrl: string) => {
      try {
        const nextPath = await completeDesktopAuthDeepLink(rawUrl);
        await getToken();
        markDeviceAuthenticated();
        clearFromWelcomeFlow();
        clearSignUpIntent();
        const session = await desktopGetAuthToken({ refresh: false });
        if (session?.userId) {
          void initializeDesktopVault(session.userId);
        }
        void recordDesktopShellEvent('desktop.auth_deep_link.received', 'info', {
          nextPath,
        });
        router.replace(nextPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void recordDesktopShellEvent('desktop.auth_deep_link.failed', 'error', {
          error: message,
          rawUrl,
        });
        console.warn('Failed to handle desktop auth deep link:', error);
      }
    };

    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        if (cancelled) {
          return;
        }

        unlisten = await listen<string>(DESKTOP_AUTH_DEEP_LINK_EVENT, (event) => {
          if (typeof event.payload === 'string') {
            void handleDesktopDeepLink(event.payload);
          }
        });

      })
      .catch((error) => {
        void recordDesktopShellEvent('desktop.auth_deep_link.listener_failed', 'warn', {
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn('Desktop auth deep link listener unavailable:', error);
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [getToken, isDesktop, router]);

  return null;
}
