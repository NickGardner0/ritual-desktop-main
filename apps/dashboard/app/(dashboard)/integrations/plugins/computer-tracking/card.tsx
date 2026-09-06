'use client';

import { Monitor } from 'lucide-react';
import { IntegrationCard } from '../../integrations-client.shared';
import type { IntegrationCardItem } from '../types';
import type { IntegrationCardRuntimeContext } from '../types';

export function buildCard(ctx: IntegrationCardRuntimeContext): IntegrationCardItem | null {
  if (!ctx.isDesktop) {
    return null;
  }

  const {
    computerTrackingConnected,
    computerTrackingConnecting,
    computerTrackingRegistered,
    handleComputerTrackingConnect,
    handleComputerTrackingDisconnect,
    openIntegrationDetails,
  } = ctx;

  const running = Boolean(computerTrackingConnected);

  return {
    id: 'computer',
    title: 'Computer Use',
    description: 'Track your computer usage including apps, websites, and active time automatically.',
    keywords: ['computer tracking', 'desktop', 'watcher', 'apps', 'websites'],
    isConnected: running,
    node: (
      <IntegrationCard
        logo={<Monitor className="h-7 w-7 text-gray-900" />}
        title="Computer Use"
        description="Track your computer usage including apps, websites, and active time automatically."
        details={running || !computerTrackingRegistered ? undefined : 'Not running'}
        isConnected={running}
        isConnecting={Boolean(computerTrackingConnecting)}
        connectLabel={computerTrackingRegistered ? 'Start' : 'Connect'}
        onConnect={() => void handleComputerTrackingConnect()}
        onDisconnect={() => void handleComputerTrackingDisconnect()}
        onDetails={() => openIntegrationDetails('computer')}
      />
    ),
  };
}
