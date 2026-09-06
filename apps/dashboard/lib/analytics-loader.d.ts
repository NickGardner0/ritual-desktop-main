export class AnalyticsLoadError extends Error {
  status: number | null;
  constructor(message: string, status?: number | null);
}

export class AnalyticsLoader {
  load<T>(options: {
    scope: string;
    key: string;
    freshnessMs?: number;
    request: (signal: AbortSignal) => Promise<T>;
  }): Promise<T>;
  release(scope: string, key?: string): void;
  invalidate(prefix?: string): void;
}

export function fetchAnalyticsJsonPair(
  signal: AbortSignal,
  firstUrl: string,
  secondUrl: string,
): Promise<[unknown, unknown]>;

export const analyticsLoader: AnalyticsLoader;
