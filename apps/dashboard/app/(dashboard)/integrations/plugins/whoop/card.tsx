'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { IntegrationCard } from '../../integrations-client.shared';
import type { IntegrationCardItem } from '../types';
import type { IntegrationCardRuntimeContext } from '../types';

export function buildCard(ctx: IntegrationCardRuntimeContext): IntegrationCardItem | null {
  const {
    effectiveWhoopConnected,
    handleWhoopConnect,
    handleWhoopDisconnect,
    handleWhoopSync,
    openIntegrationDetails,
    syncing,
    whoopConnecting,
    whoopSyncFeedback,
  } = ctx;

  return {
    id: 'whoop',
    title: 'Whoop',
    description: 'Track your recovery, sleep, and strain data from your Whoop device.',
    keywords: ['sleep', 'recovery', 'strain', 'wearable'],
    isConnected: Boolean(effectiveWhoopConnected),
    node: (
      <IntegrationCard
        logo={
          <Image
            src="/images/whoop.svg"
            alt="Whoop"
            width={80}
            height={32}
            className="h-6 w-auto object-contain"
          />
        }
        title="Whoop"
        description="Track your recovery, sleep, and strain data from your Whoop device."
        isConnected={Boolean(effectiveWhoopConnected)}
        isConnecting={Boolean(whoopConnecting)}
        isSyncing={Boolean(syncing)}
        details={
          whoopSyncFeedback ? (
            <p
              className={cn(
                'line-clamp-2 text-[11px] leading-4',
                (whoopSyncFeedback as { type: string }).type === 'error'
                  ? 'text-[#9a3412]'
                  : (whoopSyncFeedback as { type: string }).type === 'success'
                    ? 'text-[#3f6f13]'
                    : 'text-gray-500',
              )}
            >
              {(whoopSyncFeedback as { message: string }).message}
            </p>
          ) : null
        }
        onConnect={handleWhoopConnect as () => void}
        onSync={() => (handleWhoopSync as () => void)()}
        onDisconnect={handleWhoopDisconnect as () => void}
        onDetails={() => openIntegrationDetails('whoop')}
      />
    ),
  };
}
