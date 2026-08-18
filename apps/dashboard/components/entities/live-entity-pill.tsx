"use client";

import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import type { EntityRef, EntitySummary } from "@ritual/shared-contracts";
import { EntityPill } from "@/components/entities/entity-pill";
import { resolveEntity, subscribeEntitySummaries } from "@/lib/entities/resolve";

export function LiveEntityPill({
  entityRef,
  className,
  disableLink = false,
}: {
  entityRef: EntityRef;
  className?: string;
  disableLink?: boolean;
}) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [summary, setSummary] = useState<EntitySummary | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => subscribeEntitySummaries(() => setEpoch((value) => value + 1)), []);

  useEffect(() => {
    let cancelled = false;
    void resolveEntity(entityRef, { userId: user?.id, getToken }).then((item) => {
      if (!cancelled) setSummary(item);
    });
    return () => {
      cancelled = true;
    };
  }, [entityRef.id, entityRef.type, epoch, getToken, user?.id]);

  if (!summary) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--ritual-border-subtle)] bg-[var(--ritual-surface-raised)] px-2 py-0.5 text-[12px] text-[var(--ritual-text-muted)]">
        …
      </span>
    );
  }

  return (
    <EntityPill
      summary={summary}
      className={className}
      disableLink={disableLink}
    />
  );
}
