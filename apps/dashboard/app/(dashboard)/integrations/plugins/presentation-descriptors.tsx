'use client';

import Image from 'next/image';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { IntegrationCard } from '../integrations-client.shared';
import { renderIntegrationAutoSyncDetails } from '../integrations-client.wearable-details';
import { IntegrationPanelHeader } from './shared/panel-chrome';
import type { IntegrationPlugin, IntegrationRuntimeContext, LegacyWearableProvider } from './types';

function WearableAction({ ctx, provider }: { ctx: IntegrationRuntimeContext; provider: LegacyWearableProvider }) {
  return (
    <button
      onClick={() => ctx.handleWearableProviderSync(provider)}
      disabled={ctx.wearableSyncingProvider === provider}
      className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
    >
      {ctx.wearableSyncingProvider === provider ? 'Syncing...' : 'Sync now'}
    </button>
  );
}

function WearableDetailPanel({
  ctx,
  provider,
  title,
  subtitle,
  description,
}: {
  ctx: IntegrationRuntimeContext;
  provider: LegacyWearableProvider;
  title: string;
  subtitle: string;
  description: string;
}) {
  const connection = provider === 'oura' ? ctx.ouraConnection : ctx.garminConnection;
  const connected = connection?.status === 'active';
  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader
        integration={provider}
        title={title}
        subtitle={subtitle}
        action={<WearableAction ctx={ctx} provider={provider} />}
      />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion type="multiple" defaultValue={['how-it-works', ...(connected ? ['settings'] : [])]} className="pt-4">
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">{description}</AccordionContent>
            </AccordionItem>
            {connected ? (
              <AccordionItem value="settings" className="border-[#e7e5dd]">
                <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">Sync settings</AccordionTrigger>
                <AccordionContent>{renderIntegrationAutoSyncDetails(ctx, provider, connection, null, null)}</AccordionContent>
              </AccordionItem>
            ) : null}
          </Accordion>
        </ScrollArea>
      </div>
    </div>
  );
}

function buildWearableDescriptor(options: {
  provider: LegacyWearableProvider;
  title: string;
  description: string;
  subtitle: string;
  keywords: string[];
  image: string;
}): IntegrationPlugin {
  const { provider, title, description, subtitle, keywords, image } = options;
  return {
    id: provider,
    detailKey: provider,
    title,
    keywords,
    buildCard: (ctx) => {
      const connection = provider === 'oura' ? ctx.ouraConnection : ctx.garminConnection;
      const connected = connection?.status === 'active';
      return {
        id: provider,
        title,
        description,
        keywords,
        isConnected: connected,
        node: (
          <IntegrationCard
            logo={<Image src={image} alt={title} width={60} height={28} className="h-7 w-auto object-contain" />}
            title={title}
            description={description}
            isConnected={connected}
            isConnecting={ctx.wearableConnectingProvider === provider}
            isSyncing={ctx.wearableSyncingProvider === provider}
            onConnect={() => ctx.handleWearableProviderConnect(provider)}
            onSync={() => ctx.handleWearableProviderSync(provider)}
            onDisconnect={() => ctx.handleWearableProviderDisconnect(provider)}
            onDetails={() => ctx.openIntegrationDetails(provider)}
          />
        ),
      };
    },
    DetailPanel: ({ ctx }) => (
      <WearableDetailPanel ctx={ctx} provider={provider} title={title} subtitle={subtitle} description={description} />
    ),
  };
}

type StaticOptions = {
  id: string;
  detailKey: string;
  title: string;
  description: string;
  keywords: string[];
  image: string;
};

function buildComingSoonDescriptor(options: StaticOptions): IntegrationPlugin {
  return {
    ...options,
    buildCard: (ctx) => ({
      id: options.id,
      title: options.title,
      description: options.description,
      keywords: options.keywords,
      isConnected: false,
      node: (
        <IntegrationCard
          logo={<Image src={options.image} alt={options.title} width={48} height={32} className="h-7 w-auto object-contain" />}
          title={options.title}
          description={options.description}
          descriptionLineClamp={3}
          comingSoon
          onDetails={() => ctx.openIntegrationDetails(options.detailKey)}
        />
      ),
    }),
    DetailPanel: () => (
      <div className="flex h-full flex-col bg-white">
        <IntegrationPanelHeader
          integration={options.detailKey}
          title={options.title}
          subtitle="Available soon"
          action={<button disabled className="px-4 py-2 text-sm border border-[#d8d5cb] text-[#8a877d] rounded-sm">Coming soon</button>}
        />
        <div className="min-h-0 flex-1 px-5">
          <ScrollArea className="h-full">
            <Accordion type="multiple" defaultValue={['how-it-works']} className="pt-4">
              <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
                <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">How it works</AccordionTrigger>
                <AccordionContent className="text-sm text-[#69665c]">{options.description}</AccordionContent>
              </AccordionItem>
            </Accordion>
          </ScrollArea>
        </div>
      </div>
    ),
  };
}

export const PRESENTATION_DESCRIPTORS: readonly IntegrationPlugin[] = [
  buildWearableDescriptor({
    provider: 'oura', title: 'Oura Ring', subtitle: 'Sleep & readiness • By Oura', image: '/images/oura.svg',
    description: 'Sync your sleep, readiness, HRV, and temperature trends from Oura Ring.',
    keywords: ['sleep', 'readiness', 'hrv', 'temperature'],
  }),
  buildWearableDescriptor({
    provider: 'garmin', title: 'Garmin', subtitle: 'Activity & recovery • By Garmin', image: '/images/garmin.svg',
    description: 'Integrate Garmin devices for activity, workout, sleep, and recovery tracking.',
    keywords: ['activity', 'workout', 'sleep', 'recovery'],
  }),
  buildComingSoonDescriptor({ id: 'imessage', detailKey: 'imessage', title: 'iMessage', image: '/images/imessage.svg', keywords: ['sms', 'messages', 'copilot', 'chatbot'], description: 'Use Ritual’s SMS companion for ambient behavioral support, quick logging, and lightweight daily check-ins.' }),
  buildComingSoonDescriptor({ id: 'raycast', detailKey: 'raycast', title: 'Raycast', image: '/images/raycast.png', keywords: ['launcher', 'extension', 'search', 'logging'], description: 'Use the Ritual Raycast extension for quick time tracking, logging, and search.' }),
  buildComingSoonDescriptor({ id: 'obsidian', detailKey: 'obsidian', title: 'Obsidian', image: '/images/obsidian.svg', keywords: ['vault', 'markdown', 'notes', 'export'], description: 'Connect to your Obsidian vault to export your behavioral data into markdown files.' }),
  buildComingSoonDescriptor({ id: 'fitbit', detailKey: 'fitbit', title: 'Fitbit', image: '/images/fitbit.svg', keywords: ['activity', 'health', 'wearable'], description: 'Connect your Fitbit to track activity and health metrics.' }),
  buildComingSoonDescriptor({ id: 'cal-ai', detailKey: 'calai', title: 'Cal AI', image: '/images/cal_ai.svg', keywords: ['nutrition', 'calories', 'food'], description: 'Track your nutrition and calories with AI-powered food recognition.' }),
  buildComingSoonDescriptor({ id: 'google-calendar', detailKey: 'googlecalendar', title: 'Google Calendar', image: '/images/Google_Calendar_Logo.svg', keywords: ['calendar', 'meetings', 'events'], description: 'Track meeting time, frequency, and patterns by syncing your Google Calendar events.' }),
];
