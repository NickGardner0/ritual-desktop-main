'use client';

import { useEffect, useState } from 'react';
import { OpenPanelComponent, useOpenPanel } from '@openpanel/nextjs';
import { useUser } from '@clerk/nextjs';
import { canSendToCloud } from '@ritual/shared-contracts';
import { readPrivacySettings, type PrivacySettings } from '@/lib/privacy/privacy-settings';

/**
 * OpenPanel Analytics Provider
 * 
 * This component initializes OpenPanel for analytics tracking and
 * automatically identifies users when they sign in via Clerk.
 */

const OPENPANEL_CLIENT_ID = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID || '';

// User identification component that syncs with Clerk
function OpenPanelUserIdentifier() {
  const { user, isLoaded, isSignedIn } = useUser();
  const op = useOpenPanel();

  useEffect(() => {
    if (!isLoaded) return;

    if (isSignedIn && user) {
      // Identify the user with their Clerk profile data
      op.identify({
        profileId: user.id,
        properties: {
          signedIn: true,
        },
      });
    } else {
      // Clear user data when signed out
      op.clear();
    }
  }, [isLoaded, isSignedIn, user, op]);

  return null;
}

interface OpenPanelProviderProps {
  children: React.ReactNode;
}

export function OpenPanelProvider({ children }: OpenPanelProviderProps) {
  const [settings, setSettings] = useState<PrivacySettings>(() => readPrivacySettings());

  useEffect(() => {
    const handleChange = () => setSettings(readPrivacySettings());
    window.addEventListener('ritual:privacy-settings-changed', handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener('ritual:privacy-settings-changed', handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  // Don't render if client ID is not configured
  if (!OPENPANEL_CLIENT_ID) {
    console.warn('[OpenPanel] NEXT_PUBLIC_OPENPANEL_CLIENT_ID is not set. Analytics disabled.');
    return <>{children}</>;
  }

  const telemetryDecision = canSendToCloud({
    mode: settings.mode,
    consents: settings.consents,
    dataClass: 'product_telemetry',
    destination: 'openpanel',
    purpose: 'product_telemetry',
  });

  if (!telemetryDecision.allowed) {
    return <>{children}</>;
  }

  return (
    <>
      <OpenPanelComponent
        clientId={OPENPANEL_CLIENT_ID}
        trackScreenViews={true}
        trackOutgoingLinks={true}
        trackAttributes={true}
      />
      <OpenPanelUserIdentifier />
      {children}
    </>
  );
}
