'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { IPHONE_TIME_CARD_DESCRIPTION, IntegrationCard } from '../../integrations-client.shared';
import type { IntegrationCardItem } from '../types';
import type { IntegrationCardRuntimeContext } from '../types';

export function buildCard(ctx: IntegrationCardRuntimeContext): IntegrationCardItem | null {
  if (!ctx.isDesktop) {
    return null;
  }

  const {
    handleIphoneTimeConnect,
    handleIphoneTimeSync,
    iphoneTimeConnecting,
    iphoneTimeIntegration,
    iphoneTimeStatusLoading,
    iphoneTimeSyncing,
    openIntegrationDetails,
  } = ctx;

  const integration = iphoneTimeIntegration as
    | {
        isConnected?: boolean;
        status?: string;
        statusLabel?: string;
        lastImportedDate?: string;
      }
    | undefined;

  return {
    id: 'apple-screen-time',
    title: 'Apple Screen Time',
    description: IPHONE_TIME_CARD_DESCRIPTION,
    keywords: ['screen time', 'digital habits', 'iphone', 'ipad', 'biome', 'app usage'],
    isConnected: Boolean(integration?.isConnected),
    node: (
      <IntegrationCard
        logo={<Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={28} height={28} className="h-7 w-7" />}
        title="Apple Screen Time"
        description={IPHONE_TIME_CARD_DESCRIPTION}
        isStatusLoading={Boolean(iphoneTimeStatusLoading)}
        isConnected={Boolean(integration?.isConnected)}
        isConnecting={Boolean(iphoneTimeConnecting)}
        isSyncing={Boolean(iphoneTimeSyncing)}
        syncLabel="Sync Now"
        details={
          integration ? (
            <p
              className={cn(
                'line-clamp-2 text-[11px] leading-4',
                integration.status === 'error'
                  ? 'text-[#9a3412]'
                  : integration.status === 'connected'
                    ? 'text-[#3f6f13]'
                    : 'text-gray-500',
              )}
            >
              {integration.statusLabel}
              {integration.lastImportedDate ? ` • Last imported ${integration.lastImportedDate}` : ''}
            </p>
          ) : null
        }
        onConnect={handleIphoneTimeConnect as () => void}
        onSync={handleIphoneTimeSync as () => void}
        onDisconnect={() => openIntegrationDetails('screentime')}
        onDetails={() => openIntegrationDetails('screentime')}
      />
    ),
  };
}
