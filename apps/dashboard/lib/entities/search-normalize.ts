import { canonicalEntityType, entityRoute, entityTypeToPrivacyClass, type EntitySummary } from "@ritual/shared-contracts";

type SearchBucket = { hits?: Array<Record<string, unknown>>; found?: number };

export function summariesFromSearchBuckets(payload: {
  habits?: SearchBucket;
  logs?: SearchBucket;
  conversations?: SearchBucket;
  artifacts?: SearchBucket;
}): EntitySummary[] {
  const items: EntitySummary[] = [];
  for (const hit of payload.habits?.hits || []) {
    const id = String(hit.id || "");
    if (!id) continue;
    items.push({
      ref: { type: "habit", id },
      title: String(hit.name || "Habit"),
      subtitle: typeof hit.category === "string" ? hit.category : undefined,
      icon: typeof hit.icon === "string" ? hit.icon : undefined,
      route: entityRoute("habit", id),
      privacyClass: entityTypeToPrivacyClass("habit"),
      availability: "ok",
    });
  }
  for (const hit of payload.logs?.hits || []) {
    const id = String(hit.id || "");
    if (!id) continue;
    items.push({
      ref: { type: "habit_log", id },
      title: String(hit.habit_name || "Log"),
      subtitle: typeof hit.date === "string" ? hit.date : undefined,
      route: entityRoute("habit_log", id),
      privacyClass: entityTypeToPrivacyClass("habit_log"),
      availability: "ok",
    });
  }
  for (const hit of payload.conversations?.hits || []) {
    const id = String(hit.conversation_id || hit.id || "");
    if (!id) continue;
    items.push({
      ref: { type: "conversation", id },
      title: String(hit.content_preview || hit.title || "Conversation"),
      route: entityRoute("conversation", id),
      privacyClass: entityTypeToPrivacyClass("conversation"),
      availability: "ok",
    });
  }
  for (const hit of payload.artifacts?.hits || []) {
    const id = String(hit.id || "");
    if (!id) continue;
    items.push({
      ref: { type: "artifact", id },
      title: String(hit.title || "Report"),
      subtitle: typeof hit.kind === "string" ? hit.kind : undefined,
      route: entityRoute("artifact", id),
      privacyClass: entityTypeToPrivacyClass("artifact"),
      availability: "ok",
    });
  }
  return items;
}

export function mergeEntitySummaries(...groups: EntitySummary[][]): EntitySummary[] {
  const seen = new Set<string>();
  const merged: EntitySummary[] = [];
  for (const group of groups) {
    for (const item of group) {
      const type = canonicalEntityType(item.ref.type);
      if (!type) continue;
      const key = `${type}:${item.ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(type === item.ref.type ? item : { ...item, ref: { type, id: item.ref.id } });
    }
  }
  return merged;
}
