'use client';

import Image from 'next/image';
import { IntegrationCard } from '../../integrations-client.shared';
import type { IntegrationCardItem } from '../types';
import type { IntegrationCardRuntimeContext } from '../types';

export function buildCard(ctx: IntegrationCardRuntimeContext): IntegrationCardItem | null {
  const {
    effectiveTeslaConnected,
    handleTeslaConnect,
    handleTeslaDisconnect,
    handleTeslaSync,
    openIntegrationDetails,
    teslaConnecting,
    teslaSyncing,
  } = ctx;

  return {
    id: 'tesla',
    title: 'Tesla',
    description: 'Track miles driven from your Tesla vehicles.',
    keywords: ['car', 'vehicle', 'driving', 'miles'],
    isConnected: Boolean(effectiveTeslaConnected),
    node: (
      <IntegrationCard
        logo={<Image src="/images/Tesla_T_symbol.svg" alt="Tesla" width={24} height={24} className="h-6 w-6" />}
        title="Tesla"
        description="Track miles driven from your Tesla vehicles."
        isConnected={Boolean(effectiveTeslaConnected)}
        isConnecting={Boolean(teslaConnecting)}
        isSyncing={Boolean(teslaSyncing)}
        onConnect={handleTeslaConnect as () => void}
        onSync={handleTeslaSync as () => void}
        onDisconnect={handleTeslaDisconnect as () => void}
        onDetails={() => openIntegrationDetails('tesla')}
      />
    ),
  };
}
