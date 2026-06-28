'use client';

import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { IntegrationCard } from './integrations-client.shared';
import { buildRegisteredIntegrationCards } from './plugins/registry';
import type { IntegrationCardItem, IntegrationCardRuntimeContext } from './plugins/types';

export function buildIntegrationCards(ctx: IntegrationCardRuntimeContext): IntegrationCardItem[] {
  const {
    garminConnection,
    handleWearableProviderConnect,
    handleWearableProviderDisconnect,
    handleWearableProviderSync,
    openIntegrationDetails,
    ouraConnection,
    wearableConnectingProvider,
    wearableSyncingProvider,
  } = ctx;

  const registeredById = Object.fromEntries(
    buildRegisteredIntegrationCards(ctx).map((card) => [card.id, card]),
  ) as Record<string, IntegrationCardItem>;

  const legacyCards: IntegrationCardItem[] = [
    {
      id: 'oura',
      title: 'Oura Ring',
      description: 'Sync your sleep, readiness, HRV, and temperature trends from Oura Ring.',
      keywords: ['sleep', 'readiness', 'hrv', 'temperature'],
      isConnected: !!ouraConnection && (ouraConnection as { status?: string }).status === 'active',
      node: (
        <IntegrationCard
          logo={
            <Image
              src="/images/oura.svg"
              alt="Oura"
              width={40}
              height={40}
              className="h-7 w-auto object-contain scale-[1.45] origin-left"
            />
          }
          title="Oura Ring"
          description="Sync your sleep, readiness, HRV, and temperature trends from Oura Ring."
          isConnected={!!ouraConnection && (ouraConnection as { status?: string }).status === 'active'}
          isConnecting={wearableConnectingProvider === 'oura'}
          isSyncing={wearableSyncingProvider === 'oura'}
          onConnect={() => (handleWearableProviderConnect as (provider: 'oura') => void)('oura')}
          onSync={() => (handleWearableProviderSync as (provider: 'oura') => void)('oura')}
          onDisconnect={() => (handleWearableProviderDisconnect as (provider: 'oura') => void)('oura')}
          onDetails={() => openIntegrationDetails('oura')}
        />
      ),
    },
    {
      id: 'garmin',
      title: 'Garmin',
      description: 'Integrate Garmin devices for activity, workout, sleep, and recovery tracking.',
      keywords: ['activity', 'workout', 'sleep', 'recovery'],
      isConnected: !!garminConnection && (garminConnection as { status?: string }).status === 'active',
      node: (
        <IntegrationCard
          logo={<Image src="/images/garmin.svg" alt="Garmin" width={60} height={24} className="h-6 w-auto object-contain" />}
          title="Garmin"
          description="Integrate Garmin devices for activity, workout, sleep, and recovery tracking."
          isConnected={!!garminConnection && (garminConnection as { status?: string }).status === 'active'}
          isConnecting={wearableConnectingProvider === 'garmin'}
          isSyncing={wearableSyncingProvider === 'garmin'}
          onConnect={() => (handleWearableProviderConnect as (provider: 'garmin') => void)('garmin')}
          onSync={() => (handleWearableProviderSync as (provider: 'garmin') => void)('garmin')}
          onDisconnect={() => (handleWearableProviderDisconnect as (provider: 'garmin') => void)('garmin')}
          onDetails={() => openIntegrationDetails('garmin')}
        />
      ),
    },
    {
      id: 'imessage',
      title: 'iMessage',
      description: 'Use Ritual’s SMS companion for ambient behavioral support, quick logging, and lightweight daily check-ins.',
      keywords: ['sms', 'messages', 'copilot', 'chatbot'],
      isConnected: false,
      node: (
        <IntegrationCard
          logo={<Image src="/images/imessage.svg" alt="iMessage" width={32} height={32} className="h-6 w-6 rounded-[5px]" />}
          title="iMessage"
          description="Use Ritual’s SMS companion for ambient behavioral support, quick logging, and lightweight daily check-ins."
          descriptionLineClamp={3}
          comingSoon
          onDetails={() => openIntegrationDetails('imessage')}
        />
      ),
    },
    {
      id: 'raycast',
      title: 'Raycast',
      description: 'Use the Ritual Raycast extension for quick time tracking, logging, and search.',
      keywords: ['launcher', 'extension', 'search', 'logging'],
      isConnected: false,
      node: (
        <IntegrationCard
          logo={<Image src="/images/raycast.png" alt="Raycast" width={36} height={36} className="h-9 w-9 rounded-lg object-contain" />}
          title="Raycast"
          description="Use the Ritual Raycast extension for quick time tracking, logging, and search."
          descriptionLineClamp={3}
          comingSoon
          onDetails={() => openIntegrationDetails('raycast')}
        />
      ),
    },
    {
      id: 'obsidian',
      title: 'Obsidian',
      description: 'Connect to your Obsidian vault to export your behavioral data into markdown files.',
      keywords: ['vault', 'markdown', 'notes', 'export'],
      isConnected: false,
      node: (
        <IntegrationCard
          logo={<Image src="/images/obsidian.svg" alt="Obsidian" width={24} height={24} className="h-7 w-7" />}
          title="Obsidian"
          description="Connect to your Obsidian vault to export your behavioral data into markdown files."
          descriptionLineClamp={3}
          comingSoon
          onDetails={() => openIntegrationDetails('obsidian')}
        />
      ),
    },
    {
      id: 'fitbit',
      title: 'Fitbit',
      description: 'Connect your Fitbit to track activity and health metrics',
      keywords: ['activity', 'health', 'wearable'],
      isConnected: false,
      node: (
        <IntegrationCard
          logo={<Image src="/images/fitbit.svg" alt="Fitbit" width={60} height={24} className="h-6 w-auto object-contain" />}
          title="Fitbit"
          description="Connect your Fitbit to track activity and health metrics"
          comingSoon
          onDetails={() => openIntegrationDetails('fitbit')}
        />
      ),
    },
    {
      id: 'cal-ai',
      title: 'Cal AI',
      description: 'Track your nutrition and calories with AI-powered food recognition',
      keywords: ['nutrition', 'calories', 'food'],
      isConnected: false,
      node: (
        <IntegrationCard
          logo={<Image src="/images/cal_ai.svg" alt="Cal AI" width={80} height={32} className="h-8 w-auto object-contain" />}
          title="Cal AI"
          description="Track your nutrition and calories with AI-powered food recognition"
          comingSoon
          onDetails={() => openIntegrationDetails('calai')}
        />
      ),
    },
    {
      id: 'google-calendar',
      title: 'Google Calendar',
      description: 'Track meeting time, frequency, and patterns by syncing your Google Calendar events',
      keywords: ['calendar', 'meetings', 'events'],
      isConnected: false,
      node: (
        <IntegrationCard
          logo={<Image src="/images/Google_Calendar_Logo.svg" alt="Google Calendar" width={24} height={24} className="h-6 w-6" />}
          title="Google Calendar"
          description="Track meeting time, frequency, and patterns by syncing your Google Calendar events"
          comingSoon
          onDetails={() => openIntegrationDetails('googlecalendar')}
        />
      ),
    },
  ];

  const orderedIds = [
    'computer',
    'apple-screen-time',
    'apple-watch',
    'whoop',
    'oura',
    'garmin',
    'plaid',
    'tesla',
    'imessage',
    'raycast',
    'obsidian',
    'fitbit',
    'cal-ai',
    'google-calendar',
  ];

  const legacyById = Object.fromEntries(legacyCards.map((card) => [card.id, card]));

  return orderedIds
    .map((id) => registeredById[id] ?? legacyById[id])
    .filter((card): card is IntegrationCardItem => Boolean(card));
}

export function IntegrationCardsGrid({
  integrationCards,
  integrationFilter,
  integrationSearch,
  setIntegrationFilter,
  setIntegrationSearch,
}: {
  integrationCards: IntegrationCardItem[];
  integrationFilter: 'all' | 'connected';
  integrationSearch: string;
  setIntegrationFilter: Dispatch<SetStateAction<'all' | 'connected'>>;
  setIntegrationSearch: Dispatch<SetStateAction<string>>;
}) {
  const normalizedIntegrationSearch = integrationSearch.trim().toLowerCase();

  const visibleIntegrationCards = useMemo(() => {
    return integrationCards.filter((item) => {
      if (integrationFilter === 'connected' && !item.isConnected) {
        return false;
      }

      if (!normalizedIntegrationSearch) {
        return true;
      }

      const searchableContent = [
        item.title,
        item.description,
        ...(item.keywords ?? []),
      ]
        .join(' ')
        .toLowerCase();

      return searchableContent.includes(normalizedIntegrationSearch);
    });
  }, [integrationCards, integrationFilter, normalizedIntegrationSearch]);

  return (
    <>
      <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full max-w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            value={integrationSearch}
            onChange={(event) => setIntegrationSearch(event.target.value)}
            placeholder="Search"
            className="h-8 rounded-sm border-gray-300 pl-8 text-[13px] shadow-none"
            aria-label="Search integrations"
          />
        </div>

        <div className="inline-flex w-fit rounded-sm border border-gray-300 bg-white">
          <button
            type="button"
            onClick={() => setIntegrationFilter('all')}
            className={cn(
              'rounded-l-sm px-3 py-1.5 text-[13px] transition-colors',
              integrationFilter === 'all'
                ? 'bg-[#F3F3F3] text-gray-900'
                : 'bg-white text-gray-500 hover:bg-[#F8F8F8]',
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setIntegrationFilter('connected')}
            className={cn(
              'rounded-r-sm border-l border-gray-300 px-3 py-1.5 text-[13px] transition-colors',
              integrationFilter === 'connected'
                ? 'bg-[#F3F3F3] text-gray-900'
                : 'bg-white text-gray-500 hover:bg-[#F8F8F8]',
            )}
          >
            Connected
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleIntegrationCards.map((item) => (
          <div key={item.id}>{item.node}</div>
        ))}

        {!visibleIntegrationCards.length && (
          <div className="col-span-full rounded-sm border border-gray-300 bg-[#FAFAFA] px-6 py-12 text-center">
            <h2 className="text-base font-medium text-gray-900">No integrations found</h2>
            <p className="mt-2 text-sm text-gray-500">
              {integrationFilter === 'connected'
                ? normalizedIntegrationSearch
                  ? `No connected integrations match “${integrationSearch.trim()}”.`
                  : 'You do not have any connected integrations yet.'
                : normalizedIntegrationSearch
                  ? `No integrations match “${integrationSearch.trim()}”.`
                  : 'No integrations are available right now.'}
            </p>
            {(integrationFilter !== 'all' || normalizedIntegrationSearch) && (
              <button
                type="button"
                onClick={() => {
                  setIntegrationFilter('all');
                  setIntegrationSearch('');
                }}
                className="mt-4 rounded-sm border border-gray-300 px-4 py-2 text-sm text-gray-900 hover:bg-[#F3F3F3]"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
