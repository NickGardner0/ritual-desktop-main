'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import {
  desktopCompleteAuthHandoff,
  getDesktopRuntimeInfo,
  recordDesktopShellEvent,
} from '@/lib/native-gateway';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  consumeDesktopAuthHandoff,
  storePendingDesktopAuthAcknowledgement,
} from '@/lib/desktop-auth-handoff';
import {
  buildDesktopHostedAuthCallbackUrl,
  shouldCompleteDesktopAuthOnHostedOrigin,
} from '@/lib/desktop-auth-origin';

const DESKTOP_AUTH_DEEP_LINK_EVENT = 'desktop://auth-deep-link';

async function normalizeDesktopDeepLinkToAppPath(rawUrl: string): Promise<string> {
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

  const host = parsed.hostname.trim();
  const path = parsed.pathname.replace(/^\/+/, '');
  const route = `/${[host, path].filter(Boolean).join('/')}`;

  if (route === '/') {
    throw new Error('Desktop auth deep link did not include a target route.');
  }

  const handoffId = parsed.searchParams.get('handoff_id')?.trim() || '';
  const nonce = parsed.searchParams.get('nonce')?.trim() || '';
  const channel = parsed.searchParams.get('channel');
  const ticket = parsed.searchParams.get('ticket')?.trim() || '';
  if (legacyV1) {
    if (!ticket) throw new Error('Legacy desktop authentication callback is missing its ticket.');
    return `${route}?${new URLSearchParams({ ticket }).toString()}`;
  }
  if (
    !handoffId || !nonce || ticket || handoffProtocol !== '2'
    || channel !== runtimeInfo.channel
    || runtimeInfo.handoffProtocol !== '2'
  ) {
    throw new Error('Desktop authentication handoff identity does not match this app.');
  }
  const claimedTicket = await consumeDesktopAuthHandoff({
    handoffId,
    nonce,
    channel: runtimeInfo.channel,
    protocol: '2',
    runtimeInfo,
  });
  await desktopCompleteAuthHandoff(handoffId);
  storePendingDesktopAuthAcknowledgement(handoffId);
  const safeParams = new URLSearchParams({ ticket: claimedTicket, handoff_id: handoffId });
  return `${route}?${safeParams.toString()}`;
}

export function DesktopAuthDeepLinkBridge() {
  const { isDesktop } = useDesktopCapabilities();
  const router = useRouter();

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('ritual_sidebar_window') === '1') {
        return;
      }
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const handleDesktopDeepLink = async (rawUrl: string) => {
      try {
        const nextPath = await normalizeDesktopDeepLinkToAppPath(rawUrl);
        void recordDesktopShellEvent('desktop.auth_deep_link.received', 'info', {
          nextPath,
        });
        if (shouldCompleteDesktopAuthOnHostedOrigin()) {
          const hostedCallbackUrl = buildDesktopHostedAuthCallbackUrl(nextPath);
          void recordDesktopShellEvent('desktop.auth_ticket.hosted_handoff', 'info', {
            hostedCallbackUrl,
          });
          window.location.replace(hostedCallbackUrl);
          return;
        }
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
  }, [isDesktop, router]);

  return null;
}
