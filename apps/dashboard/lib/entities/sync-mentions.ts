"use client";

import {
  canonicalEntityType,
  parseEntityMentionTokens,
  type EntityRef,
} from "@ritual/shared-contracts";
import { apiJson, apiJsonWithAuth } from "@/lib/api/client";
import { entityProtocolEnabled } from "@/lib/entities/feature-flag";

type AuthGetter = (opts?: { skipCache?: boolean }) => Promise<string | null>;

export async function syncEntityMentions(options: {
  source: EntityRef;
  text?: string | null;
  extraTargets?: Array<{ type: string; id: string }>;
  provenance?: "user" | "assistant" | "workflow";
  userId?: string | null;
  getToken?: AuthGetter;
}): Promise<void> {
  if (!entityProtocolEnabled()) return;
  const seen = new Set<string>();
  const targets: EntityRef[] = [];
  for (const ref of [...parseEntityMentionTokens(options.text || ""), ...(options.extraTargets || [])]) {
    const type = canonicalEntityType(ref.type);
    const id = String(ref.id || "").trim();
    if (!type || !id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ type, id });
  }

  const payload = {
    source: options.source,
    targets,
    provenance: options.provenance || "user",
  };

  try {
    if (options.getToken) {
      await apiJsonWithAuth("/api/entities/references/sync", options.getToken, {
        method: "POST",
        userId: options.userId,
        body: JSON.stringify(payload),
      });
      return;
    }
    await apiJson("/api/entities/references/sync", {
      method: "POST",
      userId: options.userId,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn("[entities] mention sync failed", error);
  }
}
