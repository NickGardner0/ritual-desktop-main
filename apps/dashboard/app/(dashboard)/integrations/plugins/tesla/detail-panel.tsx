'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { IntegrationPanelHeader } from '../shared/panel-chrome';
import type { IntegrationRuntimeContext } from '../types';

type TeslaConnection = {
  last_sync_at?: string | null;
};

export function DetailPanel({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const {
    effectiveTeslaConnected,
    handleTeslaBackfill,
    handleTeslaSync,
    setTeslaBackfillDate,
    setTeslaBackfillOdometer,
    teslaBackfillDate,
    teslaBackfillOdometer,
    teslaBackfilling,
    teslaConnection,
    teslaSyncing,
  } = ctx;

  const connection = teslaConnection as TeslaConnection | undefined;

  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader integration="tesla" title="Tesla" subtitle="Miles driven • By Tesla" />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion type="multiple" defaultValue={['how-it-works', ...(effectiveTeslaConnected ? ['settings'] : [])]} className="pt-4">
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                How it works
              </AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">
                <p className="mb-3">
                  Ritual reads your Tesla&apos;s odometer every 6 hours and logs the miles you&apos;ve driven as a daily habit.
                </p>
                <p>
                  On the first sync, your current odometer is saved as a baseline. From then on, each sync computes the difference and logs new miles driven.
                </p>
              </AccordionContent>
            </AccordionItem>
            {effectiveTeslaConnected ? (
              <>
                <AccordionItem value="settings" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                    Sync settings
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pb-4">
                      <div>
                        <p className="text-sm text-[#69665c]">
                          Odometer is synced automatically every 6 hours. You can also sync manually.
                        </p>
                        {connection?.last_sync_at ? (
                          <p className="mt-2 text-xs text-[#9d9a90]">
                            Last synced: {new Date(connection.last_sync_at).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={handleTeslaSync as () => void}
                        disabled={Boolean(teslaSyncing)}
                        className="w-full rounded-sm border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        {teslaSyncing ? 'Syncing...' : 'Sync now'}
                      </button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="backfill" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                    Backfill historical miles
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pb-4">
                      <p className="text-sm text-[#69665c]">
                        Enter a past odometer reading from your Tesla app to backfill daily miles between that date and today. Miles will be distributed evenly across each day.
                      </p>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#69665c]">Odometer reading (miles)</label>
                        <input
                          type="number"
                          value={teslaBackfillOdometer as string}
                          onChange={(e) => (setTeslaBackfillOdometer as (value: string) => void)(e.target.value)}
                          placeholder="e.g. 42150"
                          className="w-full rounded-sm border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#69665c]">As of date</label>
                        <input
                          type="date"
                          value={teslaBackfillDate as string}
                          onChange={(e) => (setTeslaBackfillDate as (value: string) => void)(e.target.value)}
                          className="w-full rounded-sm border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleTeslaBackfill as () => void}
                        disabled={Boolean(teslaBackfilling) || !teslaBackfillOdometer || !teslaBackfillDate}
                        className="w-full rounded-sm border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        {teslaBackfilling ? 'Backfilling...' : 'Backfill miles'}
                      </button>
                      <p className="text-xs text-[#9d9a90]">
                        Tip: Open the Tesla app → tap your car → Vehicle → Odometer to find past readings.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </>
            ) : null}
          </Accordion>
        </ScrollArea>
      </div>
    </div>
  );
}
