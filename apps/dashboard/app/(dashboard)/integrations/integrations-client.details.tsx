'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { IntegrationPanelHeader } from './plugins/shared/panel-chrome';
import { renderIntegrationAutoSyncDetails } from './integrations-client.wearable-details';
import { getIntegrationPluginByDetailKey } from './plugins/registry';
import type { IntegrationRuntimeContext } from './plugins/types';

function renderRegisteredIntegrationDetailPanel(
  selectedIntegration: string | null,
  ctx: IntegrationRuntimeContext,
) {
  if (!selectedIntegration) {
    return null;
  }

  const plugin = getIntegrationPluginByDetailKey(selectedIntegration);
  if (!plugin) {
    return null;
  }

  const RegisteredDetailPanel = plugin.DetailPanel;
  return <RegisteredDetailPanel ctx={ctx} />;
}

function LegacyPanelAction({ ctx, selectedIntegration }: { ctx: IntegrationRuntimeContext; selectedIntegration: string }) {
  const { handleWearableProviderSync, wearableSyncingProvider } = ctx;

  if (selectedIntegration === 'oura') {
    return (
      <button
        onClick={() => (handleWearableProviderSync as (provider: 'oura') => void)('oura')}
        disabled={wearableSyncingProvider === 'oura'}
        className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
      >
        {wearableSyncingProvider === 'oura' ? 'Syncing...' : 'Sync now'}
      </button>
    );
  }

  if (selectedIntegration === 'garmin') {
    return (
      <button
        onClick={() => (handleWearableProviderSync as (provider: 'garmin') => void)('garmin')}
        disabled={wearableSyncingProvider === 'garmin'}
        className="px-4 py-2 text-sm border border-[#1f1e1a] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
      >
        {wearableSyncingProvider === 'garmin' ? 'Syncing...' : 'Sync now'}
      </button>
    );
  }

  return (
    <button disabled className="px-4 py-2 text-sm border border-[#d8d5cb] text-[#8a877d] rounded-sm">
      Coming soon
    </button>
  );
}

function renderOuraDetailsPanel(ctx: IntegrationRuntimeContext) {
  const { ouraConnection } = ctx;

  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader
        integration="oura"
        title="Oura Ring"
        subtitle="Sleep & readiness • By Oura"
        action={<LegacyPanelAction ctx={ctx} selectedIntegration="oura" />}
      />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion
            type="multiple"
            defaultValue={['how-it-works', ...(ouraConnection && (ouraConnection as { status?: string }).status === 'active' ? ['settings'] : [])]}
            className="pt-4"
          >
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                How it works
              </AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">
                Sync your sleep, readiness, HRV, and temperature trends from Oura Ring.
              </AccordionContent>
            </AccordionItem>
            {ouraConnection && (ouraConnection as { status?: string }).status === 'active' ? (
              <AccordionItem value="settings" className="border-[#e7e5dd]">
                <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                  Sync settings
                </AccordionTrigger>
                <AccordionContent>
                  {renderIntegrationAutoSyncDetails(ctx, 'oura', ouraConnection, null, null)}
                </AccordionContent>
              </AccordionItem>
            ) : null}
          </Accordion>
        </ScrollArea>
      </div>
    </div>
  );
}

function renderGarminDetailsPanel(ctx: IntegrationRuntimeContext) {
  const { garminConnection } = ctx;

  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader
        integration="garmin"
        title="Garmin"
        subtitle="Activity & recovery • By Garmin"
        action={<LegacyPanelAction ctx={ctx} selectedIntegration="garmin" />}
      />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion
            type="multiple"
            defaultValue={['how-it-works', ...(garminConnection && (garminConnection as { status?: string }).status === 'active' ? ['settings'] : [])]}
            className="pt-4"
          >
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                How it works
              </AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">
                Integrate Garmin devices for activity, workout, sleep, and recovery tracking.
              </AccordionContent>
            </AccordionItem>
            {garminConnection && (garminConnection as { status?: string }).status === 'active' ? (
              <AccordionItem value="settings" className="border-[#e7e5dd]">
                <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                  Sync settings
                </AccordionTrigger>
                <AccordionContent>
                  {renderIntegrationAutoSyncDetails(ctx, 'garmin', garminConnection, null, null)}
                </AccordionContent>
              </AccordionItem>
            ) : null}
          </Accordion>
        </ScrollArea>
      </div>
    </div>
  );
}

function renderDefaultDetailsPanel(ctx: IntegrationRuntimeContext) {
  const { selectedIntegration } = ctx;

  const titles: Record<string, string> = {
    computer: 'Computer Use',
    screentime: 'Apple Screen Time',
    fitbit: 'Fitbit',
    imessage: 'iMessage',
    raycast: 'Raycast',
    obsidian: 'Obsidian',
    calai: 'Cal AI',
    googlecalendar: 'Google Calendar',
  };

  const integrationKey = selectedIntegration || 'computer';
  const logoKey = integrationKey === 'computer' ? 'computer' : integrationKey;

  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader
        integration={logoKey}
        title={titles[integrationKey] || 'Integration Details'}
        subtitle={integrationKey === 'computer' ? 'Desktop tracking • Local device' : 'Available soon'}
        action={<LegacyPanelAction ctx={ctx} selectedIntegration={integrationKey} />}
      />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion type="multiple" defaultValue={['how-it-works']} className="pt-4">
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                How it works
              </AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">
                {integrationKey === 'computer'
                  ? 'Manage computer tracking from the Computer Tracking settings panel.'
                  : 'Additional integration details and setup controls will live here.'}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </ScrollArea>
      </div>
    </div>
  );
}

export function renderIntegrationDetailsPanel(
  selectedIntegration: string | null,
  ctx: IntegrationRuntimeContext,
) {
  if (!selectedIntegration) {
    return null;
  }

  const registeredPanel = renderRegisteredIntegrationDetailPanel(selectedIntegration, ctx);
  if (registeredPanel) {
    return registeredPanel;
  }

  if (selectedIntegration === 'oura') {
    return renderOuraDetailsPanel(ctx);
  }

  if (selectedIntegration === 'garmin') {
    return renderGarminDetailsPanel(ctx);
  }

  return renderDefaultDetailsPanel(ctx);
}
