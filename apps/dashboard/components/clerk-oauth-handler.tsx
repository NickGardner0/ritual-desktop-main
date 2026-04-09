'use client';

import { useEffect } from 'react';

import { isTauri, openInBrowser } from '@/lib/tauri-utils';

type DesktopOAuthMode = 'sign_in' | 'sign_up';

interface ClerkOAuthHandlerProps {
  mode?: DesktopOAuthMode;
  enabled?: boolean;
}

function getOAuthStrategyFromElement(element: HTMLElement | null): 'oauth_google' | 'oauth_apple' | null {
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

function buildDesktopOAuthStartUrl(mode: DesktopOAuthMode, strategy: 'oauth_google' | 'oauth_apple'): string {
  const url = new URL('/auth/desktop-start-oauth', window.location.origin);
  url.searchParams.set('mode', mode);
  url.searchParams.set('strategy', strategy);
  return url.toString();
}

export function ClerkOAuthHandler({
  mode = 'sign_in',
  enabled = true,
}: ClerkOAuthHandlerProps) {
  useEffect(() => {
    if (!enabled || !isTauri()) {
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
      void openInBrowser(oauthStartUrl);
    };

    document.addEventListener('click', handleClickCapture, true);

    return () => {
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [enabled, mode]);

  return null;
}
