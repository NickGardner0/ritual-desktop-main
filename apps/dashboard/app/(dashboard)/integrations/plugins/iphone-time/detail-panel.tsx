'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { IntegrationPanelHeader } from '../shared/panel-chrome';
import { IPHONE_TIME_ICLOUD_WARNING } from '../../integrations-client.shared';
import type { IntegrationRuntimeContext } from '../types';
import { PanelAction } from './panel-action';

export function DetailPanel({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const {
    handleIphoneTimeImport,
    iphoneTimeImporting,
    iphoneTimeIntegration,
    iphoneTimeStatusLoading,
    iphoneTimeSyncing,
  } = ctx;

  const status = iphoneTimeIntegration as
    | {
        statusLabel?: string;
        lastImportedDate?: string;
        totalImportedEvents?: number;
        outboxCount?: number;
        localSourceFileCount?: number;
        lastDrainLabel?: string;
        lastError?: string;
        warning?: string;
        isConnected?: boolean;
        notes?: string[];
      }
    | undefined;

  const statRows = [
    ['Current status', status?.statusLabel || (iphoneTimeStatusLoading ? 'Checking...' : 'Unknown')],
    ['Last imported date', status?.lastImportedDate || 'None yet'],
    ['Total imported events', Number(status?.totalImportedEvents || 0).toLocaleString()],
    ['Outbox count', Number(status?.outboxCount || 0).toLocaleString()],
    ['Local Biome files', Number(status?.localSourceFileCount || 0).toLocaleString()],
    ['Last drain', status?.lastDrainLabel || 'Never'],
  ];
  const hasSourceFiles = Number(status?.localSourceFileCount || 0) > 0;
  const helperCommand =
    '/Users/Shared/ritual-watcher-biome-diagnostic --biome-export-jsonl /Users/Shared/ritual-biome-iphone-export.jsonl';

  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader
        integration="screentime"
        title="Apple Screen Time"
        subtitle="iPhone Time • Apple Biome"
        action={<PanelAction ctx={ctx} />}
      />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <div className="space-y-6 pb-6 pt-4">
            <div className="rounded-sm border border-[#e7e5dd] bg-[#fbfaf7] p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {statRows.map(([label, value]) => (
                  <div key={label} className="rounded-sm border border-[#e7e5dd] bg-white px-3 py-2">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#8a877d]">{label}</p>
                    <p className="mt-1 text-sm font-medium text-[#1f1e1a]">{value}</p>
                  </div>
                ))}
              </div>
              {status?.lastError ? (
                <p className="mt-3 rounded-sm border border-[#f4c7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#9a3412]">
                  {status.lastError}
                </p>
              ) : null}
            </div>

            {status?.warning || (!hasSourceFiles && !status?.isConnected) ? (
              <div className="rounded-sm border border-[#f1d2aa] bg-[#fff8ed] p-4 text-sm leading-6 text-[#6b4a1f]">
                {status?.warning || IPHONE_TIME_ICLOUD_WARNING}
              </div>
            ) : null}

            <Accordion type="multiple" defaultValue={['setup', 'bridge']} className="border-t border-[#e7e5dd]">
              <AccordionItem value="setup" className="border-[#e7e5dd]">
                <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                  Setup
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm leading-6 text-[#69665c]">
                  <p>
                    Ritual reads Apple Biome App.InFocus data that macOS syncs locally when this Mac user is signed into the same iCloud account as the iPhone.
                  </p>
                  <p>
                    Keep Computer Use running. When Biome source files appear, Ritual parses iPhone foreground app intervals, queues them locally, and syncs them to the backend as the `iPhone Time` habit.
                  </p>
                  {hasSourceFiles && !status?.isConnected && Number(status?.outboxCount || 0) === 0 ? (
                    <p className="rounded-sm border border-[#e7e5dd] bg-white px-3 py-2 text-xs text-[#8a877d]">
                      Source files exist. If no events are queued yet, wait for the watcher scan or restart Computer Use.
                    </p>
                  ) : null}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="bridge" className="border-[#e7e5dd]">
                <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                  Using a different iCloud account?
                </AccordionTrigger>
                <AccordionContent className="space-y-4 text-sm leading-6 text-[#69665c]">
                  <p>
                    If your iPhone syncs Biome data into another macOS user account, export from that account and import the file here. Ritual validates rows, dedupes by stable event key, and never deletes the source export.
                  </p>
                  <div className="rounded-sm border border-[#e7e5dd] bg-[#111111] p-3 font-mono text-xs leading-5 text-white">
                    {helperCommand}
                  </div>
                  <button
                    type="button"
                    onClick={handleIphoneTimeImport as () => void}
                    disabled={Boolean(iphoneTimeImporting) || Boolean(iphoneTimeSyncing)}
                    className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {iphoneTimeImporting ? 'Importing...' : 'Import Export File'}
                  </button>
                </AccordionContent>
              </AccordionItem>

              {status?.notes?.length ? (
                <AccordionItem value="diagnostics" className="border-[#e7e5dd]">
                  <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                    Diagnostics
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-2 text-sm leading-6 text-[#69665c]">
                      {status.notes.map((note: string, index: number) => (
                        <li key={`${index}-${note}`}>{note}</li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ) : null}
            </Accordion>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
