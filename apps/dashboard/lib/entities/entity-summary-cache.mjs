const ENTITY_TYPE_ALIASES = {
  report: "artifact",
  calendar: "calendar_block",
};

function entityRefKey(ref) {
  const type = ENTITY_TYPE_ALIASES[ref.type] || ref.type;
  return `${type}:${ref.id}`;
}

export const ENTITY_SUMMARY_TTL_MS = 60_000;

export function entitySummaryCacheKey(userId, ref) {
  const owner = (typeof userId === "string" && userId.trim()) || "anon";
  return `${owner}:${entityRefKey(ref)}`;
}

export function shouldPersistEntitySummary(summary) {
  return summary.availability !== "unknown";
}

function summariesMatch(left, right) {
  return Boolean(
    left
    && left.title === right.title
    && left.status === right.status
    && left.subtitle === right.subtitle
    && left.availability === right.availability,
  );
}

export class EntitySummaryCache {
  constructor() {
    this.entries = new Map();
    this.inflight = new Map();
    this.listeners = new Map();
  }

  get(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.summary;
  }

  set(key, summary, now = Date.now()) {
    if (!shouldPersistEntitySummary(summary)) {
      const had = this.entries.delete(key);
      if (had) this.notify(key);
      return false;
    }
    const previous = this.entries.get(key)?.summary;
    this.entries.set(key, { summary, expiresAt: now + ENTITY_SUMMARY_TTL_MS });
    if (summariesMatch(previous, summary)) return false;
    this.notify(key);
    return true;
  }

  delete(key) {
    if (!this.entries.delete(key)) return;
    this.notify(key);
  }

  clear() {
    const keys = [...this.entries.keys(), ...this.listeners.keys()];
    this.entries.clear();
    this.inflight.clear();
    for (const key of new Set(keys)) this.notify(key);
  }

  dedupe(key, loader) {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const request = loader().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, request);
    return request;
  }

  subscribe(key, listener) {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      const current = this.listeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (!current.size) this.listeners.delete(key);
    };
  }

  notify(key) {
    for (const listener of this.listeners.get(key) ?? []) listener();
    if (key !== "*") {
      for (const listener of this.listeners.get("*") ?? []) listener();
    }
  }
}

const summaryCache = new EntitySummaryCache();
let activeCacheUserId = null;

export function getEntitySummaryCacheUser() {
  return activeCacheUserId;
}

export function setEntitySummaryCacheUser(userId) {
  activeCacheUserId = userId;
}

export function peekEntitySummary(ref, userId = activeCacheUserId) {
  return summaryCache.get(entitySummaryCacheKey(userId, ref));
}

export function rememberEntitySummary(summary, userId = activeCacheUserId) {
  summaryCache.set(entitySummaryCacheKey(userId, summary.ref), summary);
}

export function forgetEntitySummary(ref, userId = activeCacheUserId) {
  summaryCache.delete(entitySummaryCacheKey(userId, ref));
}

export function subscribeEntitySummary(ref, listener, userId = activeCacheUserId) {
  return summaryCache.subscribe(entitySummaryCacheKey(userId, ref), listener);
}

export function subscribeEntitySummaries(listener) {
  return summaryCache.subscribe("*", listener);
}

export function clearEntitySummaryCache() {
  summaryCache.clear();
}

export function loadEntitySummary(ref, userId, loader) {
  const key = entitySummaryCacheKey(userId, ref);
  const cached = summaryCache.get(key);
  if (cached) return Promise.resolve(cached);
  return summaryCache.dedupe(key, async () => {
    const summary = await loader();
    summaryCache.set(key, summary);
    return summary;
  });
}

export function readCachedEntitySummary(ref, userId) {
  return summaryCache.get(entitySummaryCacheKey(userId, ref));
}

export function writeCachedEntitySummary(ref, userId, summary) {
  summaryCache.set(entitySummaryCacheKey(userId, ref), summary);
}
