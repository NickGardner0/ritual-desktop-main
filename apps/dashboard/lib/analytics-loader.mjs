export class AnalyticsLoadError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'AnalyticsLoadError';
    this.status = status;
  }
}

export class AnalyticsLoader {
  #cache = new Map();
  #inFlight = new Map();
  #scopeKeys = new Map();

  async load({ scope, key, freshnessMs = 30_000, request }) {
    const now = Date.now();
    const cached = this.#cache.get(key);
    if (cached && now - cached.loadedAt <= freshnessMs) return cached.value;

    const previousKey = this.#scopeKeys.get(scope);
    if (previousKey && previousKey !== key) this.release(scope, previousKey);
    this.#scopeKeys.set(scope, key);

    const existing = this.#inFlight.get(key);
    if (existing) {
      existing.scopes.add(scope);
      return existing.promise;
    }

    const controller = new AbortController();
    const entry = { controller, scopes: new Set([scope]), promise: null };
    entry.promise = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return request(controller.signal);
      })
      .then((value) => {
        this.#cache.set(key, { value, loadedAt: Date.now() });
        return value;
      })
      .finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, entry);
    return entry.promise;
  }

  release(scope, key = this.#scopeKeys.get(scope)) {
    if (!key) return;
    if (this.#scopeKeys.get(scope) === key) this.#scopeKeys.delete(scope);
    const entry = this.#inFlight.get(key);
    if (!entry) return;
    entry.scopes.delete(scope);
    if (entry.scopes.size === 0) entry.controller.abort();
  }

  invalidate(prefix = '') {
    for (const key of this.#cache.keys()) {
      if (key.startsWith(prefix)) this.#cache.delete(key);
    }
  }
}

export async function fetchAnalyticsJsonPair(signal, firstUrl, secondUrl) {
  const [firstResponse, secondResponse] = await Promise.all([
    fetch(firstUrl, { signal }),
    fetch(secondUrl, { signal }),
  ]);
  if (!firstResponse.ok || !secondResponse.ok) {
    throw new AnalyticsLoadError(
      `Analytics request failed (first=${firstResponse.status}, second=${secondResponse.status})`,
      Math.max(firstResponse.status, secondResponse.status),
    );
  }
  return Promise.all([firstResponse.json(), secondResponse.json()]);
}

export const analyticsLoader = new AnalyticsLoader();
