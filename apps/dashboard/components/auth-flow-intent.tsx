'use client';

import { useEffect } from 'react';

import { clearSignUpIntent, markSignUpIntent } from '@/lib/onboarding-flow';

type AuthFlowIntentMode = 'sign_in' | 'sign_up';

export function AuthFlowIntent({ mode }: { mode: AuthFlowIntentMode }) {
  useEffect(() => {
    if (mode === 'sign_up') {
      markSignUpIntent();
      return;
    }

    clearSignUpIntent();
  }, [mode]);

  return null;
}
