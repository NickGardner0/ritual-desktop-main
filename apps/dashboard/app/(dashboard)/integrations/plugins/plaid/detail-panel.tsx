'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { IntegrationPanelHeader } from '../shared/panel-chrome';
import { formatHour, formatRelativeTime } from '../../integrations-client.shared';
import type { IntegrationRuntimeContext } from '../types';
import { PanelAction } from './panel-action';

type PlaidAccount = {
  account_subtype?: string | null;
  account_type?: string | null;
  id: string;
  include_in_spending?: boolean;
  is_active?: boolean;
  mask?: string | null;
  name?: string | null;
};

type PlaidConnection = {
  account_count?: number | null;
  accounts?: PlaidAccount[];
  auto_sync_enabled?: boolean | null;
  institution_name?: string | null;
  last_successful_sync_at?: string | null;
  last_sync_at?: string | null;
  latest_transaction_date?: string | null;
  sync_hour?: number | null;
};

function PlaidSyncDetails({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const {
    handlePlaidAccountInclusion,
    handlePlaidSyncSettingsUpdate,
    plaidAccountSavingId,
    plaidConnected,
    plaidConnection,
    plaidNeedsReconnect,
    plaidReconnectReason,
    plaidConnecting,
    plaidSettingsSaving,
    handlePlaidReconnect,
  } = ctx;

  if (!plaidConnection || !plaidConnected) {
    return null;
  }

  const connection = plaidConnection as PlaidConnection;

  return (
    <div className="space-y-4">
      {plaidNeedsReconnect ? (
        <div className="rounded-sm border border-gray-200 bg-white p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Reconnect required</p>
          <p className="mt-2 text-sm leading-6 text-gray-900">{plaidReconnectReason as string}</p>
          <div className="mt-3">
            <button
              onClick={handlePlaidReconnect as () => void}
              disabled={Boolean(plaidConnecting)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-sm hover:bg-[#f3f3f3] disabled:opacity-50"
            >
              {plaidConnecting ? 'Reconnecting...' : 'Reconnect bank'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-sm border border-gray-200 bg-white p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Institution</p>
          <p className="mt-1 text-sm text-gray-900">{connection.institution_name || 'Connected bank'}</p>
        </div>
        <div className="rounded-sm border border-gray-200 bg-white p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Active accounts</p>
          <p className="mt-1 text-sm text-gray-900">{connection.account_count || 0}</p>
        </div>
      </div>

      <div className="rounded-sm border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Auto sync</p>
            <p className="mt-1 text-sm text-gray-600">Keep spending totals current in the background.</p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={connection.auto_sync_enabled ?? true}
              disabled={Boolean(plaidSettingsSaving)}
              onChange={(event) =>
                (handlePlaidSyncSettingsUpdate as (updates: { auto_sync_enabled?: boolean; sync_hour?: number }) => void)({
                  auto_sync_enabled: event.target.checked,
                  sync_hour: connection.sync_hour ?? 9,
                })
              }
              className="h-3.5 w-3.5 rounded border-gray-300 text-black focus:ring-0"
            />
            <span>{connection.auto_sync_enabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
          <div>
            <p className="text-sm text-gray-900">Preferred sync time</p>
            <p className="mt-1 text-xs text-gray-500">Choose when Ritual should refresh spending totals.</p>
          </div>
          <select
            value={connection.sync_hour ?? 9}
            disabled={Boolean(plaidSettingsSaving) || !(connection.auto_sync_enabled ?? true)}
            onChange={(event) =>
              (handlePlaidSyncSettingsUpdate as (updates: { auto_sync_enabled?: boolean; sync_hour?: number }) => void)({
                auto_sync_enabled: connection.auto_sync_enabled ?? true,
                sync_hour: Number(event.target.value),
              })
            }
            className="h-9 min-w-[112px] rounded-sm border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:opacity-50"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {formatHour(hour)}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
          <span>Last sync</span>
          <span className="text-gray-700">
            {formatRelativeTime(connection.last_sync_at || connection.last_successful_sync_at)}
          </span>
        </div>
        {connection.latest_transaction_date ? (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>Latest imported date</span>
            <span className="text-gray-700">{connection.latest_transaction_date}</span>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Included accounts</p>
        <div className="space-y-2">
          {(connection.accounts || [])
            .filter((account) => account.is_active)
            .map((account) => (
              <label
                key={account.id}
                className="flex items-start gap-3 rounded-sm border border-gray-200 bg-white p-3 text-sm text-gray-900"
              >
                <input
                  type="checkbox"
                  checked={account.include_in_spending}
                  disabled={plaidAccountSavingId === account.id}
                  onChange={(event) =>
                    (handlePlaidAccountInclusion as (id: string, included: boolean) => void)(
                      account.id,
                      event.target.checked,
                    )
                  }
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-black focus:ring-0"
                />
                <span className="leading-4">
                  <span className="block text-gray-900">
                    {account.name}
                    {account.mask ? ` ••${account.mask}` : ''}
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {(account.account_type || 'account').replace('_', ' ')}
                    {account.account_subtype ? ` · ${String(account.account_subtype).replace('_', ' ')}` : ''}
                  </span>
                </span>
              </label>
            ))}
          {!(connection.accounts || []).some((account) => account.is_active) ? (
            <p className="rounded-sm border border-dashed border-gray-200 bg-white p-3 text-sm text-gray-500">
              No active accounts available yet.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DetailPanel({ ctx }: { ctx: IntegrationRuntimeContext }) {
  const { handlePlaidBackfill, plaidBackfilling, plaidConnected, plaidNeedsReconnect } = ctx;
  const subtitle = `Bank sync • ${plaidNeedsReconnect ? 'Reconnect required' : plaidConnected ? 'By Plaid' : 'Ready to connect'}`;

  return (
    <div className="flex h-full flex-col bg-white">
      <IntegrationPanelHeader integration="plaid" title="Plaid" subtitle={subtitle} action={<PanelAction ctx={ctx} />} />
      <div className="min-h-0 flex-1 px-5">
        <ScrollArea className="h-full">
          <Accordion type="multiple" defaultValue={['how-it-works', 'settings']} className="pt-4">
            <AccordionItem value="how-it-works" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                How it works
              </AccordionTrigger>
              <AccordionContent className="text-sm text-[#69665c]">
                Connect Plaid to import full available spending history from posted depository transactions. Ritual converts that into one daily Spending value instead of exposing a transaction ledger.
                {plaidConnected ? (
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={handlePlaidBackfill as () => void}
                      disabled={Boolean(plaidBackfilling)}
                      className="px-3 py-2 text-sm border border-[#d8d5cb] rounded-sm hover:bg-[#f3f1ea] disabled:opacity-50"
                    >
                      {plaidBackfilling ? 'Backfilling...' : 'Backfill history'}
                    </button>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="settings" className="border-[#e7e5dd]">
              <AccordionTrigger className="py-3 text-base font-medium text-[#1f1e1a] hover:no-underline">
                Sync settings
              </AccordionTrigger>
              <AccordionContent>
                <PlaidSyncDetails ctx={ctx} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <div className="border-t border-[#e7e5dd] pb-5 pt-6">
            <p className="text-[11px] leading-5 text-[#8a877d]">
              Plaid is used here only to compute daily spending totals. Individual transaction categorization and merchant analytics are intentionally out of scope for this Ritual integration.
            </p>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
