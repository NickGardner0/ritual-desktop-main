"use client";

import { cn } from "@/lib/utils";
import { EntityNoteText } from "@/components/entities/entity-note-text";
import { EntityPreviewCard } from "@/components/entities/entity-pill";
import { resolveEntity } from "@/lib/entities/resolve";
import { canonicalEntityType, entityRoute, type EntitySummary } from "@ritual/shared-contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

interface ArtifactBodyProps {
  body?: {
    schemaVersion?: number;
    blocks?: Array<Record<string, unknown>>;
  } | null;
  emptyMessage?: string;
  className?: string;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function EntityEmbedBlock({
  entityType,
  entityId,
  title,
}: {
  entityType: string;
  entityId: string;
  title?: string;
}) {
  const [summary, setSummary] = useState<EntitySummary | null>(null);
  const canonicalType = canonicalEntityType(entityType);
  useEffect(() => {
    if (!canonicalType || !entityId) return;
    let cancelled = false;
    void resolveEntity({ type: canonicalType, id: entityId }).then((item) => {
      if (!cancelled) setSummary(item);
    });
    return () => {
      cancelled = true;
    };
  }, [canonicalType, entityId]);

  if (!canonicalType || !entityId) return null;
  const fallback: EntitySummary = summary || {
    ref: { type: canonicalType, id: entityId },
    title: title || "Linked object",
    route: entityRoute(canonicalType, entityId),
    privacyClass: "ai_content",
    availability: "ok",
  };

  return (
    <Link href={fallback.route} className="block no-underline">
      <section className="rounded-3xl border border-[rgba(15,23,42,0.08)] bg-white/85 px-6 py-5">
        <EntityPreviewCard summary={fallback} />
      </section>
    </Link>
  );
}

export function ArtifactBody({ body, emptyMessage = "No structured content yet.", className }: ArtifactBodyProps) {
  const blocks = Array.isArray(body?.blocks) ? body?.blocks : [];

  if (!blocks.length) {
    return (
      <div className={cn("rounded-3xl border border-[rgba(15,23,42,0.08)] bg-white/80 p-6 text-sm text-[#6b7280]", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((block, index) => {
        const type = asString(block.type, "unknown");

        if (type === "hero") {
          return (
            <section
              key={`${type}-${index}`}
              className="rounded-[28px] border border-[rgba(15,23,42,0.08)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(242,246,242,0.92))] px-6 py-6"
            >
              <div className="text-xs font-[650] uppercase tracking-[0.18em] text-[#6b7280]">
                {asString(block.periodLabel, "Ritual Artifact")}
              </div>
              <h2 className="mt-2 text-[28px] font-[650] tracking-[-0.03em] text-[#111827]">
                {asString(block.title, "Untitled artifact")}
              </h2>
              {asString(block.intro) ? (
                <div className="mt-3 max-w-2xl text-[15px] leading-7 text-[#4b5563]">
                  <EntityNoteText text={asString(block.intro)} />
                </div>
              ) : null}
            </section>
          );
        }

        if (type === "summary") {
          return (
            <section
              key={`${type}-${index}`}
              className="rounded-3xl border border-[rgba(15,23,42,0.08)] bg-white/85 px-6 py-5"
            >
              <div className="text-[15px] leading-7 text-[#111827]">
                <EntityNoteText text={asString(block.text, emptyMessage)} />
              </div>
            </section>
          );
        }

        if (type === "metric_list") {
          const items = asArray(block.items);
          return (
            <section
              key={`${type}-${index}`}
              className="rounded-3xl border border-[rgba(15,23,42,0.08)] bg-white/85 px-6 py-5"
            >
              <div className="grid gap-3 md:grid-cols-2">
                {items.length
                  ? items.map((item, itemIndex) => {
                      const metric = (item || {}) as Record<string, unknown>;
                      return (
                        <div key={`metric-${itemIndex}`} className="rounded-2xl border border-[rgba(15,23,42,0.06)] bg-[#f8faf8] px-4 py-4">
                          <div className="text-xs font-[600] uppercase tracking-[0.12em] text-[#6b7280]">
                            {asString(metric.label, "Metric")}
                          </div>
                          <div className="mt-2 text-[24px] font-[650] tracking-[-0.03em] text-[#111827]">
                            {asString(metric.value, "0")}
                            {asString(metric.unit) ? <span className="ml-1 text-[15px] font-[500] text-[#6b7280]">{asString(metric.unit)}</span> : null}
                          </div>
                          {asString(metric.note) ? (
                            <div className="mt-2 text-sm leading-6 text-[#4b5563]">
                              <EntityNoteText text={asString(metric.note)} />
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  : <div className="text-sm text-[#6b7280]">No metrics available.</div>}
              </div>
            </section>
          );
        }

        if (type === "bullet_list") {
          const items = asArray(block.items);
          return (
            <section
              key={`${type}-${index}`}
              className="rounded-3xl border border-[rgba(15,23,42,0.08)] bg-white/85 px-6 py-5"
            >
              <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">
                {asString(block.title, "Notes")}
              </div>
              <ul className="mt-4 space-y-3">
                {items.length
                  ? items.map((item, itemIndex) => (
                      <li key={`bullet-${itemIndex}`} className="flex gap-3 text-[15px] leading-7 text-[#111827]">
                        <span className="mt-[10px] h-2 w-2 rounded-full bg-[#73bf1d]" />
                        <EntityNoteText text={String(item)} />
                      </li>
                    ))
                  : <li className="text-sm text-[#6b7280]">No items yet.</li>}
              </ul>
            </section>
          );
        }

        if (type === "entity_embed") {
          return (
            <EntityEmbedBlock
              key={`${type}-${index}`}
              entityType={asString(block.entity_type)}
              entityId={asString(block.entity_id)}
              title={asString(block.title) || undefined}
            />
          );
        }

        return (
          <section
            key={`${type}-${index}`}
            className="rounded-3xl border border-dashed border-[rgba(15,23,42,0.12)] bg-white/70 px-6 py-5 text-sm text-[#6b7280]"
          >
            Unsupported block type: {type}
          </section>
        );
      })}
    </div>
  );
}
