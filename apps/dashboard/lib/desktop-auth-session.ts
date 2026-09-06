'use client';

import { desktopClearAuthState } from '@/lib/native-gateway';
import {
  DEVICE_AUTHENTICATED_KEY,
  FROM_WELCOME_KEY,
  SIGN_UP_INTENT_KEY,
} from '@/lib/onboarding-flow';

const ONBOARDING_V3_STEP_KEY = 'ritual:onboarding-v3-step';
const DASHBOARD_RETURN_URL_KEY = 'ritual:dashboard-return-url:v1';

type ClerkSignOut = () => Promise<unknown>;

function clearRitualBrowserAuthState(): void {
  if (typeof window === 'undefined') return;

  window.localStorage.removeItem(DEVICE_AUTHENTICATED_KEY);
  window.localStorage.removeItem(ONBOARDING_V3_STEP_KEY);
  window.sessionStorage.removeItem(FROM_WELCOME_KEY);
  window.sessionStorage.removeItem(SIGN_UP_INTENT_KEY);
  window.sessionStorage.removeItem(DASHBOARD_RETURN_URL_KEY);
}

export async function clearRitualDesktopAuthState(): Promise<void> {
  clearRitualBrowserAuthState();
  await desktopClearAuthState();
}

export async function signOutOfRitual(signOut: ClerkSignOut): Promise<void> {
  await clearRitualDesktopAuthState().catch((error) => {
    console.warn('Ritual desktop auth cleanup before sign-out failed:', error);
  });

  try {
    await signOut();
  } finally {
    await clearRitualDesktopAuthState().catch((error) => {
      console.warn('Ritual desktop auth cleanup after sign-out failed:', error);
    });
  }
}
