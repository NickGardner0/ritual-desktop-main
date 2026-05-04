'use client';

import { useEffect } from 'react';

import { recordDesktopShellEvent } from '@/lib/desktop-bridge/observability';
import { openInBrowserFromDesktopAuth } from '@/lib/tauri-utils';

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

function buildDesktopOAuthStartUrl(mode: DesktopOAuthMode, strategy: DesktopOAuthStrategy): string {
  const url = new URL('/auth/desktop-start-oauth', window.location.origin);
  url.searchParams.set('mode', mode);
  url.searchParams.set('strategy', strategy);
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

      const oauthStartUrl = buildDesktopOAuthStartUrl(mode, strategy);
      void recordDesktopShellEvent('desktop.auth_oauth.launch_requested', 'info', {
        mode,
        strategy,
        oauthStartUrl,
      });
      void openInBrowserFromDesktopAuth(oauthStartUrl);
    };

    document.addEventListener('click', handleClickCapture, true);

    return () => {
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [desktopMode, enabled, mode]);

  return null;
}
