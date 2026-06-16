'use client';

import { Monitor } from 'lucide-react';
import { IntegrationCard } from '../../integrations-client.shared';
import type { IntegrationCardItem } from '../types';
import type { IntegrationCardRuntimeContext } from '../types';

export function buildCard(ctx: IntegrationCardRuntimeContext): IntegrationCardItem | null {
  if (!ctx.isDesktop) {
    return null;
  }

  const { computerTrackingConnected, openIntegrationDetails, router } = ctx;

  return {
    id: 'computer',
    title: 'Computer Use',
    description: 'Track your computer usage including apps, websites, and active time automatically.',
    keywords: ['computer tracking', 'desktop', 'watcher', 'apps', 'websites'],
    isConnected: Boolean(computerTrackingConnected),
    node: (
      <IntegrationCard
        logo={<Monitor className="h-7 w-7 text-gray-900" />}
        title="Computer Use"
        description="Track your computer usage including apps, websites, and active time automatically."
        isConnected={Boolean(computerTrackingConnected)}
        onConnect={() => router.replace('/integrations?openSettings=computer-tracking')}
        onDisconnect={() => router.replace('/integrations?openSettings=computer-tracking')}
        onDetails={() => openIntegrationDetails('computer')}
      />
    ),
  };
}
