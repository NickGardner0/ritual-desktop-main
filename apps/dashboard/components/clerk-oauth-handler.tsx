'use client';

import { useEffect } from 'react';

import {
  desktopBeginAuthHandoff,
  recordDesktopShellEvent,
  openInBrowserFromDesktopAuth,
  type DesktopAuthHandoffStart,
} from '@/lib/native-gateway';

type DesktopOAuthMode = 'sign_in' | 'sign_up';
type DesktopOAuthStrategy = 'oauth_google' | 'oauth_apple';

interface ClerkOAuthHandlerProps {
  mode?: DesktopOAuthMode;
  enabled?: boolean;
  desktopMode?: boolean;
}

function getOAuthStrategyFromElement(element: HTMLElement | null): DesktopOAuthStrategy | null {
  if (!element) return null;

  const button = element.closest('button, a');
  if (!button) return null;

  const text = (button.textContent || '').toLowerCase();
  const html = (button.outerHTML || '').toLowerCase();

  if (text.includes('google') || html.includes('google')) {
    return 'oauth_google';
  }

  if (text.includes('apple') || html.includes('apple')) {
    return 'oauth_apple';
  }

  return null;
}

function buildDesktopOAuthStartUrl(
  mode: DesktopOAuthMode,
  strategy: DesktopOAuthStrategy,
  handoff: DesktopAuthHandoffStart,
): string {
  const url = new URL('/auth/desktop-start-oauth', window.location.origin);
  url.searchParams.set('mode', mode);
  url.searchParams.set('strategy', strategy);
  url.searchParams.set('handoff_id', handoff.handoffId);
  url.searchParams.set('nonce_challenge', handoff.nonceChallenge);
  url.searchParams.set('channel', handoff.channel);
  url.searchParams.set('protocol', handoff.protocol);
  url.searchParams.set('expires_at_ms', String(handoff.expiresAtMs));
  url.searchParams.set('app_version', handoff.appVersion);
  url.searchParams.set('build_sha', handoff.buildSha);
  url.searchParams.set('bundle_id', handoff.bundleId);
  url.searchParams.set('callback_scheme', handoff.callbackScheme);
  if (handoff.target) url.searchParams.set('target', handoff.target);
  return url.toString();
}

export function ClerkOAuthHandler({
  mode = 'sign_in',
  enabled = true,
  desktopMode = false,
}: ClerkOAuthHandlerProps) {
  useEffect(() => {
    if (!enabled || !desktopMode) {
      return;
    }

    const handleClickCapture = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const strategy = getOAuthStrategyFromElement(target);
      if (!strategy) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof (event as MouseEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation === 'function') {
        (event as MouseEvent & { stopImmediatePropagation: () => void }).stopImmediatePropagation();
      }

      void (async () => {
        try {
          const handoff = await desktopBeginAuthHandoff();
          if (!handoff) {
            throw new Error('The installed Ritual app does not support secure browser handoff.');
          }
          const oauthStartUrl = buildDesktopOAuthStartUrl(mode, strategy, handoff);
          void recordDesktopShellEvent('desktop.auth_oauth.launch_requested', 'info', {
            mode,
            strategy,
            channel: handoff.channel,
            protocol: handoff.protocol,
          });
          await openInBrowserFromDesktopAuth(oauthStartUrl);
        } catch (error) {
          void recordDesktopShellEvent('desktop.auth_oauth.launch_failed', 'error', {
            mode,
            strategy,
            error: error instanceof Error ? error.message : String(error),
          });
          console.error('Failed to prepare secure desktop authentication:', error);
        }
      })();
    };

    document.addEventListener('click', handleClickCapture, true);

    return () => {
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [desktopMode, enabled, mode]);

  return null;
}
