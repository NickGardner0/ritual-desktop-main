'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { recordDesktopShellEvent } from '@/lib/native-gateway';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';

const DESKTOP_AUTH_DEEP_LINK_EVENT = 'desktop://auth-deep-link';

function normalizeDesktopDeepLinkToAppPath(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const protocol = parsed.protocol.toLowerCase();

  if (protocol !== 'ritual:' && protocol !== 'com.ritual.desktop:') {
    throw new Error(`Unsupported desktop auth protocol: ${parsed.protocol}`);
  }

  const host = parsed.hostname.trim();
  const path = parsed.pathname.replace(/^\/+/, '');
  const route = `/${[host, path].filter(Boolean).join('/')}`;

  if (route === '/') {
    throw new Error('Desktop auth deep link did not include a target route.');
  }

  return `${route}${parsed.search}`;
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
        const nextPath = normalizeDesktopDeepLinkToAppPath(rawUrl);
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
  }, [router]);

  return null;
}
