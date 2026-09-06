'use client';

import { useEffect, useState } from 'react';
import { OpenPanelComponent, useOpenPanel } from '@openpanel/nextjs';
import { useUser } from '@/lib/desktop-session';
import { canSendToCloud } from '@ritual/shared-contracts';
import { readPrivacySettings, type PrivacySettings } from '@/lib/privacy/privacy-settings';

const OPENPANEL_CLIENT_ID = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID || '';

function OpenPanelUserIdentifier() {
  const { user, isLoaded, isSignedIn } = useUser();
  const op = useOpenPanel();

  useEffect(() => {
    if (!isLoaded) return;

    if (isSignedIn && user) {
      op.identify({
        profileId: user.id,
        properties: {
          signedIn: true,
        },
      });
    } else {
      op.clear();
    }
  }, [isLoaded, isSignedIn, user, op]);

  return null;
}

export default function OpenPanelRuntime() {
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

  if (!OPENPANEL_CLIENT_ID) return null;

  const telemetryDecision = canSendToCloud({
    mode: settings.mode,
    consents: settings.consents,
    dataClass: 'product_telemetry',
    destination: 'openpanel',
    purpose: 'product_telemetry',
  });

  if (!telemetryDecision.allowed) return null;

  return (
    <>
      <OpenPanelComponent
        clientId={OPENPANEL_CLIENT_ID}
        trackScreenViews={true}
        trackOutgoingLinks={true}
        trackAttributes={true}
      />
      <OpenPanelUserIdentifier />
    </>
  );
}
