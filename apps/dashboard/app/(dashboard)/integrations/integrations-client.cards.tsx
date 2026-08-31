'use client';

import { useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { cn } from '@ritual/ui/cn';
import { Input } from '@ritual/ui/input';
import { getIntegrationCardProps } from './integrations-client.shared.card';
import { buildRegisteredIntegrationCards } from './plugins/registry';
import type { IntegrationCardItem, IntegrationCardRuntimeContext } from './plugins/types';

export function buildIntegrationCards(ctx: IntegrationCardRuntimeContext): IntegrationCardItem[] {
  return buildRegisteredIntegrationCards(ctx);
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-full px-3 text-[13px] font-normal transition-none',
        active
          ? 'bg-[var(--surface-panel)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      {children}
    </button>
  );
}

const shimmerClass =
  'animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-[var(--surface-panel)] via-[var(--surface-raised)] to-[var(--surface-panel)]';

export function IntegrationsMarketplaceSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[840px] px-8 py-8">
      <div className="mb-8">
        <div className={`h-7 w-40 rounded ${shimmerClass}`} />
        <div className={`mt-2 h-4 w-72 rounded ${shimmerClass}`} />
      </div>
      <div className={`mb-4 h-10 rounded-full ${shimmerClass}`} />
      <div className="mb-8 flex gap-2">
        <div className={`h-8 w-12 rounded-full ${shimmerClass}`} />
        <div className={`h-8 w-24 rounded-full ${shimmerClass}`} />
      </div>
      <div className="grid grid-cols-1 gap-x-12 gap-y-2 md:grid-cols-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex min-h-[64px] items-center gap-3 px-2 py-2">
            <div className={`h-10 w-10 shrink-0 rounded-[12px] ${shimmerClass}`} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className={`h-4 w-28 rounded ${shimmerClass}`} />
              <div className={`h-3 w-full rounded ${shimmerClass}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirectoryGrid({ items }: { items: IntegrationCardItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-x-12 gap-y-2 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.id}>{item.node}</div>
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-3 text-[16px] font-medium leading-[1.35] text-[var(--text-primary)]">
      {children}
    </h2>
  );
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

  const matchingCards = useMemo(() => {
    return integrationCards.filter((item) => {
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
  }, [integrationCards, normalizedIntegrationSearch]);

  const connectedCards = matchingCards.filter((item) => item.isConnected);
  const catalogCards = matchingCards.filter((item) => !item.comingSoon);
  const comingSoonCards = matchingCards.filter((item) => item.comingSoon);

  const isSearching = Boolean(normalizedIntegrationSearch);
  const showInstalledStrip = integrationFilter === 'all' && !isSearching && connectedCards.length > 0;
  const showDirectoryAsSearchResults = isSearching || integrationFilter === 'connected';

  const searchResultCards =
    integrationFilter === 'connected' ? connectedCards : matchingCards;

  const showEmptyState = showDirectoryAsSearchResults
    ? searchResultCards.length === 0
    : catalogCards.length === 0 && comingSoonCards.length === 0;

  return (
    <div className="mx-auto w-full max-w-[840px] px-8 py-8">
      <div className="mb-8">
        <h1 className="text-[24px] font-medium leading-[1.2] text-[var(--text-primary)]">
          Integrations
        </h1>
        <p className="mt-1 text-[14px] leading-[1.5] text-[var(--text-muted)]">
          Connect Ritual to the tools you already use.
        </p>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input
          value={integrationSearch}
          onChange={(event) => setIntegrationSearch(event.target.value)}
          placeholder="Search integrations"
          className="h-10 rounded-full border-[var(--border-floating)] bg-[var(--surface-raised)] pl-10 text-[14px] shadow-none"
          aria-label="Search integrations"
        />
      </div>

      <div className="mb-8 flex items-center gap-2">
        <FilterChip active={integrationFilter === 'all'} onClick={() => setIntegrationFilter('all')}>
          All
        </FilterChip>
        <FilterChip
          active={integrationFilter === 'connected'}
          onClick={() => setIntegrationFilter('connected')}
        >
          Connected
        </FilterChip>
      </div>

      {showInstalledStrip ? (
        <section className="mb-8">
          <SectionHeading>Installed</SectionHeading>
          <div className="flex flex-wrap gap-2">
            {connectedCards.map((item) => {
              const cardProps = getIntegrationCardProps(item.node);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => cardProps?.onDetails?.()}
                  aria-label={`${item.title} details`}
                  className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[12px] bg-[var(--surface-panel)] transition-none hover:bg-[var(--row-hover)] [&>*]:max-h-6 [&>*]:max-w-6 [&_img]:max-h-6 [&_img]:max-w-6 [&_img]:object-contain"
                >
                  {cardProps?.logo}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {showEmptyState ? (
        <div className="px-2 py-16 text-center">
          <h2 className="text-[16px] font-medium text-[var(--text-primary)]">No integrations found</h2>
          <p className="mt-2 text-[14px] text-[var(--text-muted)]">
            {integrationFilter === 'connected'
              ? normalizedIntegrationSearch
                ? `No connected integrations match “${integrationSearch.trim()}”.`
                : 'You do not have any connected integrations yet.'
              : normalizedIntegrationSearch
                ? `No integrations match “${integrationSearch.trim()}”.`
                : 'No integrations are available right now.'}
          </p>
          {(integrationFilter !== 'all' || normalizedIntegrationSearch) && (
            <Button
              type="button"
              variant="outline"
              size="compact"
              className="mt-4"
              onClick={() => {
                setIntegrationFilter('all');
                setIntegrationSearch('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : showDirectoryAsSearchResults ? (
        <DirectoryGrid items={searchResultCards} />
      ) : (
        <>
          {catalogCards.length > 0 ? (
            <section className={comingSoonCards.length > 0 ? 'mb-8' : undefined}>
              <DirectoryGrid items={catalogCards} />
            </section>
          ) : null}
          {comingSoonCards.length > 0 ? (
            <section>
              <SectionHeading>Coming soon</SectionHeading>
              <DirectoryGrid items={comingSoonCards} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
