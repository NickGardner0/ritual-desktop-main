'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { IntegrationPanelHeader } from '../shared/panel-chrome';
import { renderWhoopSyncDetailsPanel } from '../../integrations-client.wearable-details';
import type { IntegrationRuntimeContext } from '../types';
import { PanelAction } from './panel-action';

export function DetailPanel({ ctx }: { ctx: IntegrationRuntimeContext }) {
  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader
        integration="whoop"
        title="Whoop"
        subtitle="Recovery • By Whoop"
        action={<PanelAction ctx={ctx} />}
      />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion type="multiple" defaultValue={['how-it-works', 'settings']} className="pt-4">
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                How it works
              </AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">
                <div className="space-y-3">
                  <p>Track recovery, sleep, and strain data from your Whoop device and keep those habits in sync with Ritual.</p>
                  <p>
                    Smart sync resumes from the last successful checkpoint. If you want to backfill older history, use one of the manual sync presets below or run a full-history import.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="settings" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                Sync settings
              </AccordionTrigger>
              <AccordionContent>{renderWhoopSyncDetailsPanel(ctx)}</AccordionContent>
            </AccordionItem>
          </Accordion>
        </ScrollArea>
      </div>
    </div>
  );
}
