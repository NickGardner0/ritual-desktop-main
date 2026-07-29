'use client';

import Image from 'next/image';
import { IntegrationCard } from '../../integrations-client.shared';
import type { IntegrationCardItem } from '../types';
import type { IntegrationCardRuntimeContext } from '../types';

export function buildCard(ctx: IntegrationCardRuntimeContext): IntegrationCardItem | null {
  const {
    handlePlaidConnect,
    handlePlaidDisconnect,
    handlePlaidReconnect,
    handlePlaidSync,
    openIntegrationDetails,
    plaidConnected,
    plaidConnecting,
    plaidNeedsReconnect,
    plaidSyncing,
  } = ctx;

  return {
    id: 'plaid',
    title: 'Plaid',
    description: 'Track your spending by connecting your bank accounts.',
    keywords: ['bank', 'banking', 'spending', 'finance', 'financial'],
    isConnected: Boolean(plaidConnected),
    node: (
      <IntegrationCard
        logo={
          <Image src="/images/plaid-mark.svg" alt="Plaid" width={48} height={52} className="h-6 w-auto object-contain" />
        }
        title="Plaid"
        descriptionLineClamp={3}
        description="Track your spending by connecting your bank accounts."
        isConnected={Boolean(plaidConnected)}
        isConnecting={Boolean(plaidConnecting)}
        isSyncing={!plaidNeedsReconnect && Boolean(plaidSyncing)}
        connectLabel="Connect"
        onConnect={handlePlaidConnect as () => void}
        onSync={plaidNeedsReconnect ? undefined : (handlePlaidSync as () => void)}
        onDisconnect={handlePlaidDisconnect as () => void}
        onDetails={() => openIntegrationDetails('plaid')}
        extraActions={
          plaidConnected && plaidNeedsReconnect ? (
            <button
              onClick={handlePlaidReconnect as () => void}
              disabled={Boolean(plaidConnecting)}
              className="inline-flex h-7 items-center justify-center rounded-sm border border-gray-300 px-2.5 text-[12px] leading-none text-gray-900 hover:bg-[#F3F3F3] disabled:opacity-50"
            >
              {plaidConnecting ? 'Reconnecting...' : 'Reconnect'}
            </button>
          ) : null
        }
      />
    ),
  };
}
