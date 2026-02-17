'use client';

import { useEffect } from 'react';
import { OpenPanelComponent, useOpenPanel } from '@openpanel/nextjs';
import { useUser } from '@clerk/nextjs';

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
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        email: user.primaryEmailAddress?.emailAddress || undefined,
        avatar: user.imageUrl || undefined,
        properties: {
          createdAt: user.createdAt?.toISOString(),
          // Add any custom properties you want to track
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
  // Don't render if client ID is not configured
  if (!OPENPANEL_CLIENT_ID) {
    console.warn('[OpenPanel] NEXT_PUBLIC_OPENPANEL_CLIENT_ID is not set. Analytics disabled.');
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

