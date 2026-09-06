'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { IntegrationPanelHeader } from '../shared/panel-chrome';
import type { IntegrationRuntimeContext } from '../types';
import { PanelAction } from './panel-action';

export function DetailPanel({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const subtitle = ctx.computerTrackingConnected
    ? 'Tracking this Mac'
    : ctx.computerTrackingRegistered
      ? 'Installed, not running'
      : 'Desktop tracking • Local device';

  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader
        integration="computer"
        title="Computer Use"
        subtitle={subtitle}
        action={<PanelAction ctx={ctx} />}
      />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion type="multiple" defaultValue={['how-it-works']} className="pt-4">
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                How it works
              </AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">
                Ritual Watcher records app and website time on this Mac. Computer Time on Index
                reads that local activity. If tracking is paused, hours stay at zero until you
                start it again.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </ScrollArea>
      </div>
    </div>
  );
}
