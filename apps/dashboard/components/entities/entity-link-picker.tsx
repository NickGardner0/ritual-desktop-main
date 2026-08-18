"use client";

import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import type { EntityRef, EntitySummary } from "@ritual/shared-contracts";
import { parseDateMentionQuery, virtualDateSummary } from "@ritual/shared-contracts";
import { EntityPill } from "@/components/entities/entity-pill";
import { ENTITY_TYPE_LABELS } from "@/lib/entities/registry";
import { apiJsonWithAuth } from "@/lib/api/client";
import { rememberEntitySummary, searchLocalEntities } from "@/lib/entities/resolve";
import { mergeEntitySummaries } from "@/lib/entities/search-normalize";
import { Input } from "@/components/ui/input";

export function EntityLinkPicker({
  source,
  onLinked,
}: {
  source: EntityRef;
  onLinked?: () => void;
}) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<EntitySummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void (async () => {
        const [cloud, local] = await Promise.all([
          apiJsonWithAuth<{ items: EntitySummary[] }>(
            `/api/entities/search?q=${encodeURIComponent(query)}&limit=12`,
            getToken,
            { userId: user?.id },
          ).catch(() => ({ items: [] as EntitySummary[] })),
          user?.id ? searchLocalEntities(user.id, query) : Promise.resolve([]),
        ]);
        const parsed = parseDateMentionQuery(query);
        const dateHit = parsed ? [virtualDateSummary(parsed)] : [];
        setItems(mergeEntitySummaries(dateHit, local, cloud.items).filter((item) => item.ref.type !== source.type || item.ref.id !== source.id));
      })();
    }, 150);
    return () => window.clearTimeout(handle);
  }, [getToken, query, source.id, source.type, user?.id]);

  const link = async (target: EntitySummary) => {
    if (busy || target.availability !== "ok") return;
    setBusy(true);
    try {
      await apiJsonWithAuth("/api/entities/references", getToken, {
        method: "POST",
        userId: user?.id,
        body: JSON.stringify({
          source,
          target: target.ref,
          relationship: source.type === "experiment" || target.ref.type === "experiment" ? "evidence_for" : "references",
          provenance: "user",
        }),
      });
      onLinked?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Link an object…" />
      <div className="flex flex-wrap gap-1.5">
        {items.slice(0, 8).map((item) => (
          <button
            key={`${item.ref.type}:${item.ref.id}`}
            type="button"
            onClick={() => void link(item)}
            disabled={busy}
          >
            <EntityPill summary={item} disableLink />
          </button>
        ))}
      </div>
    </div>
  );
}

export function EntityMentionTypeahead({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (summary: EntitySummary) => void;
}) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [items, setItems] = useState<EntitySummary[]>([]);

  useEffect(() => {
    if (!query) {
      setItems([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        const [cloud, local] = await Promise.all([
          apiJsonWithAuth<{ items: EntitySummary[] }>(
            `/api/entities/search?q=${encodeURIComponent(query)}&limit=8`,
            getToken,
            { userId: user?.id },
          ).catch(() => ({ items: [] as EntitySummary[] })),
          user?.id ? searchLocalEntities(user.id, query) : Promise.resolve([]),
        ]);
        const parsed = parseDateMentionQuery(query);
        const dateHit = parsed ? [virtualDateSummary(parsed)] : [];
        setItems(mergeEntitySummaries(dateHit, local, cloud.items).slice(0, 8));
      })();
    }, 120);
    return () => window.clearTimeout(handle);
  }, [getToken, query, user?.id]);

  if (!items.length) return null;

  return (
    <div className="mt-2 rounded-md border border-[var(--ritual-border-subtle)] bg-[var(--ritual-surface-raised)] p-2">
      {items.map((item) => (
        <button
          key={`${item.ref.type}:${item.ref.id}`}
          type="button"
          className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-[var(--ritual-surface-panel)]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            rememberEntitySummary(item);
            onSelect(item);
          }}
        >
          <span className="truncate">{item.title}</span>
          <span className="text-[11px] text-[var(--ritual-text-muted)]">{ENTITY_TYPE_LABELS[item.ref.type]}</span>
        </button>
      ))}
    </div>
  );
}

export function mentionQueryFromInput(value: string): string | null {
  const match = value.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1] : null;
}
