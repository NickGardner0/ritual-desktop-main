'use client';

import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import Image from 'next/image';
import { Monitor, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { isTauri } from '@/lib/tauri-utils';
import { cn } from '@/lib/utils';
import { IntegrationCard } from './integrations-client.shared';

export type IntegrationCardItem = {
  id: string;
  title: string;
  description: string;
  keywords?: string[];
  isConnected: boolean;
  node: React.ReactNode;
};

export function buildIntegrationCards(ctx: Record<string, any>): IntegrationCardItem[] {
  const {
    appleWatchConnected,
    computerTrackingConnected,
    effectiveTeslaConnected,
    effectiveWhoopConnected,
    garminConnection,
    handleAppleWatchConnect,
    handleAppleWatchDisconnect,
    handlePlaidConnect,
    handlePlaidDisconnect,
    handlePlaidReconnect,
    handlePlaidSync,
    handleTeslaConnect,
    handleTeslaDisconnect,
    handleTeslaSync,
    handleWearableProviderConnect,
    handleWearableProviderDisconnect,
    handleWearableProviderSync,
    handleWhoopConnect,
    handleWhoopDisconnect,
    handleWhoopSync,
    openIntegrationDetails,
    ouraConnection,
    plaidConnected,
    plaidConnecting,
    plaidNeedsReconnect,
    plaidSyncing,
    router,
    syncing,
    teslaConnecting,
    teslaSyncing,
    wearableConnectingProvider,
    wearableSyncingProvider,
    whoopConnecting,
    whoopSyncFeedback,
  } = ctx;

  const integrationCards: Array<{
    id: string;
    title: string;
    description: string;
    keywords?: string[];
    isConnected: boolean;
    node: React.ReactNode;
  }> = [];

  if (isTauri()) {
    integrationCards.push({
      id: 'computer',
      title: 'Computer Use',
      description: 'Track your computer usage including apps, websites, and active time automatically.',
      keywords: ['computer tracking', 'desktop', 'watcher', 'apps', 'websites'],
      isConnected: computerTrackingConnected,
      node: (
        <IntegrationCard
          logo={<Monitor className="h-7 w-7 text-gray-900" />}
          title="Computer Use"
          description="Track your computer usage including apps, websites, and active time automatically."
          isConnected={computerTrackingConnected}
          onConnect={() => router.replace('/integrations?openSettings=computer-tracking')}
          onDisconnect={() => router.replace('/integrations?openSettings=computer-tracking')}
          onDetails={() => openIntegrationDetails('computer')}
        />
      ),
    });
  }

  integrationCards.push(
      {
        id: 'apple-watch',
        title: 'Apple Watch',
        description: 'Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics.',
        keywords: ['apple health', 'watch', 'steps', 'heart rate', 'sleep', 'workout'],
        isConnected: appleWatchConnected,
        node: (
          <IntegrationCard
            logo={
              <svg className="h-6 w-6" viewBox="0 0 814 1000" fill="currentColor">
                <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
              </svg>
            }
            title="Apple Watch"
            description="Sync your Apple Watch data including workouts, steps, heart rate, and sleep metrics."
            isConnected={appleWatchConnected}
            onConnect={handleAppleWatchConnect}
            onDisconnect={handleAppleWatchDisconnect}
            onDetails={() => router.replace('/integrations?openSettings=apple-health')}
          />
        ),
      },
      {
        id: 'whoop',
        title: 'Whoop',
        description: 'Track your recovery, sleep, and strain data from your Whoop device.',
        keywords: ['sleep', 'recovery', 'strain', 'wearable'],
        isConnected: effectiveWhoopConnected,
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
            isConnected={effectiveWhoopConnected}
            isConnecting={whoopConnecting}
            isSyncing={syncing}
            details={
              whoopSyncFeedback ? (
                <p
                  className={cn(
                    'line-clamp-2 text-[11px] leading-4',
                    whoopSyncFeedback.type === 'error'
                      ? 'text-[#9a3412]'
                      : whoopSyncFeedback.type === 'success'
                        ? 'text-[#3f6f13]'
                        : 'text-gray-500'
                  )}
                >
                  {whoopSyncFeedback.message}
                </p>
              ) : null
            }
            onConnect={handleWhoopConnect}
            onSync={() => handleWhoopSync()}
            onDisconnect={handleWhoopDisconnect}
            onDetails={() => openIntegrationDetails('whoop')}
          />
        ),
      },
      {
        id: 'oura',
        title: 'Oura Ring',
        description: 'Sync your sleep, readiness, HRV, and temperature trends from Oura Ring.',
        keywords: ['sleep', 'readiness', 'hrv', 'temperature'],
        isConnected: !!ouraConnection && ouraConnection.status === 'active',
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
            isConnected={!!ouraConnection && ouraConnection.status === 'active'}
            isConnecting={wearableConnectingProvider === 'oura'}
            isSyncing={wearableSyncingProvider === 'oura'}
            onConnect={() => handleWearableProviderConnect('oura')}
            onSync={() => handleWearableProviderSync('oura')}
            onDisconnect={() => handleWearableProviderDisconnect('oura')}
            onDetails={() => openIntegrationDetails('oura')}
          />
        ),
      },
      {
        id: 'garmin',
        title: 'Garmin',
        description: 'Integrate Garmin devices for activity, workout, sleep, and recovery tracking.',
        keywords: ['activity', 'workout', 'sleep', 'recovery'],
        isConnected: !!garminConnection && garminConnection.status === 'active',
        node: (
          <IntegrationCard
            logo={<Image src="/images/garmin.svg" alt="Garmin" width={60} height={24} className="h-6 w-auto object-contain" />}
            title="Garmin"
            description="Integrate Garmin devices for activity, workout, sleep, and recovery tracking."
            isConnected={!!garminConnection && garminConnection.status === 'active'}
            isConnecting={wearableConnectingProvider === 'garmin'}
            isSyncing={wearableSyncingProvider === 'garmin'}
            onConnect={() => handleWearableProviderConnect('garmin')}
            onSync={() => handleWearableProviderSync('garmin')}
            onDisconnect={() => handleWearableProviderDisconnect('garmin')}
            onDetails={() => openIntegrationDetails('garmin')}
          />
        ),
      },
      {
        id: 'plaid',
        title: 'Plaid',
        description: 'Track your spending by connecting your bank accounts.',
        keywords: ['bank', 'banking', 'spending', 'finance', 'financial'],
        isConnected: plaidConnected,
        node: (
          <IntegrationCard
            logo={
              <Image src="/images/plaid-mark.svg" alt="Plaid" width={48} height={52} className="h-6 w-auto object-contain" />
            }
            title="Plaid"
            descriptionLineClamp={3}
            description="Track your spending by connecting your bank accounts."
            isConnected={plaidConnected}
            isConnecting={plaidConnecting}
            isSyncing={!plaidNeedsReconnect && plaidSyncing}
            connectLabel="Connect"
            onConnect={handlePlaidConnect}
            onSync={plaidNeedsReconnect ? undefined : handlePlaidSync}
            onDisconnect={handlePlaidDisconnect}
            onDetails={() => openIntegrationDetails('plaid')}
            extraActions={
              plaidConnected && plaidNeedsReconnect ? (
                <button
                  onClick={handlePlaidReconnect}
                  disabled={plaidConnecting}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-sm hover:bg-[#F3F3F3] text-gray-900 disabled:opacity-50"
                >
                  {plaidConnecting ? 'Reconnecting...' : 'Reconnect'}
                </button>
              ) : null
            }
          />
        ),
      },
      {
        id: 'tesla',
        title: 'Tesla',
        description: 'Track miles driven from your Tesla vehicles.',
        keywords: ['car', 'vehicle', 'driving', 'miles'],
        isConnected: effectiveTeslaConnected,
        node: (
          <IntegrationCard
            logo={<Image src="/images/Tesla_T_symbol.svg" alt="Tesla" width={24} height={24} className="h-6 w-6" />}
            title="Tesla"
            description="Track miles driven from your Tesla vehicles."
            isConnected={effectiveTeslaConnected}
            isConnecting={teslaConnecting}
            isSyncing={teslaSyncing}
            onConnect={handleTeslaConnect}
            onSync={handleTeslaSync}
            onDisconnect={handleTeslaDisconnect}
            onDetails={() => openIntegrationDetails('tesla')}
          />
        ),
      },
      {
        id: 'apple-screen-time',
        title: 'Apple Screen Time',
        description: 'Track your digital habits by importing Screen Time data from your iPhone or iPad.',
        keywords: ['screen time', 'digital habits', 'iphone', 'ipad'],
        isConnected: false,
        node: (
          <IntegrationCard
            logo={<Image src="/images/Screen_Time.svg" alt="Apple Screen Time" width={28} height={28} className="h-7 w-7" />}
            title="Apple Screen Time"
            description="Track your digital habits by importing Screen Time data from your iPhone or iPad."
            comingSoon
            onDetails={() => openIntegrationDetails('screentime')}
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
    );

  return integrationCards;
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
                : 'bg-white text-gray-500 hover:bg-[#F8F8F8]'
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
                : 'bg-white text-gray-500 hover:bg-[#F8F8F8]'
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
