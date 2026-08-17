'use client';

import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { buildRegisteredIntegrationCards } from './plugins/registry';
import type { IntegrationCardItem, IntegrationCardRuntimeContext } from './plugins/types';

export function buildIntegrationCards(ctx: IntegrationCardRuntimeContext): IntegrationCardItem[] {
  return buildRegisteredIntegrationCards(ctx);
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

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
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
