"use client";

import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import type { EntityRef, EntitySummary } from "@ritual/shared-contracts";
import { EntityPill } from "@/components/entities/entity-pill";
import { UnknownEntity } from "@/components/entities/unknown-entity";
import { entityProtocolEnabled } from "@/lib/entities/feature-flag";
import { entityLookupPath, resolveEntities } from "@/lib/entities/resolve";
import { apiJsonWithAuth } from "@/lib/api/client";

type RelatedResponse = {
  items: Array<{
    edge: { relationship: string; source: string; ref: EntityRef };
    summary: EntitySummary;
  }>;
};

export function EntityRelatedPanel({
  entityRef,
  className,
  refreshKey = 0,
}: {
  entityRef: EntityRef;
  className?: string;
  refreshKey?: number;
}) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [items, setItems] = useState<RelatedResponse["items"]>([]);
  const enabled = entityProtocolEnabled();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiJsonWithAuth<RelatedResponse>(
          entityLookupPath(entityRef.type, entityRef.id, "related"),
          getToken,
          { userId: user?.id },
        );
        if (!cancelled) setItems(response.items || []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, entityRef.id, entityRef.type, getToken, refreshKey, user?.id]);

  if (!enabled || items.length === 0) return null;

  return (
    <section className={className}>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ritual-text-muted)]">
        Related
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) =>
          item.summary.availability === "ok" ? (
            <span key={`${item.edge.relationship}:${item.summary.ref.type}:${item.summary.ref.id}`} className="inline-flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--ritual-text-muted)]">
                {item.edge.relationship.replace(/_/g, " ")}
              </span>
              <EntityPill summary={item.summary} />
            </span>
          ) : (
            <UnknownEntity key={`${item.summary.ref.type}:${item.summary.ref.id}`} summary={item.summary} />
          ),
        )}
      </div>
    </section>
  );
}

export function EntityCitationList({
  refs,
}: {
  refs: EntityRef[];
}) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [summaries, setSummaries] = useState<EntitySummary[]>([]);
  const refKey = refs.map((ref) => `${ref.type}:${ref.id}`).join(",");

  useEffect(() => {
    if (!entityProtocolEnabled() || refs.length === 0) {
      setSummaries([]);
      return;
    }
    let cancelled = false;
    void resolveEntities(refs, { userId: user?.id, getToken }).then((items) => {
      if (!cancelled) setSummaries(items);
    });
    return () => {
      cancelled = true;
    };
  }, [getToken, refKey, user?.id]);

  if (!entityProtocolEnabled() || summaries.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {summaries.map((summary) => (
        <EntityPill key={`${summary.ref.type}:${summary.ref.id}`} summary={summary} />
      ))}
    </div>
  );
}
