export type ModelEngineErrorKind = 'canceled' | 'retryable_provider' | 'fatal_provider';

export class ModelEngineError extends Error {
  constructor(
    message: string,
    readonly kind: ModelEngineErrorKind,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ModelEngineError';
  }
}

export function classifyModelEngineError(error: unknown): ModelEngineErrorKind {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return 'canceled';
  }
  const status = error && typeof error === 'object' && 'status' in error
    ? Number(error.status)
    : Number.NaN;
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return 'retryable_provider';
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/timeout|timed out|temporar|connection|network|unavailable|rate limit/.test(message)) {
    return 'retryable_provider';
  }
  return 'fatal_provider';
}
