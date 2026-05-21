import * as Sentry from '@sentry/nextjs';

type SentryLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type StructuredLogValue = string | number | boolean | null | undefined;

type StructuredLogAttributes = Record<string, StructuredLogValue>;

const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const MAX_STRING_LENGTH = 512;

function cleanAttributeValue(value: StructuredLogValue): string | number | boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return undefined;
}

export function buildSentryLogAttributes(attributes: StructuredLogAttributes = {}) {
  const clean: Record<string, string | number | boolean | null> = {};

  for (const [key, rawValue] of Object.entries(attributes)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || !ATTRIBUTE_KEY_PATTERN.test(normalizedKey)) continue;
    const value = cleanAttributeValue(rawValue);
    if (value === undefined) continue;
    clean[normalizedKey] = value;
  }

  return clean;
}

export function sentryStructuredLog(
  level: SentryLogLevel,
  message: string,
  attributes: StructuredLogAttributes = {},
) {
  const cleanAttributes = buildSentryLogAttributes(attributes);
  const logger = Sentry.logger as Partial<Record<SentryLogLevel, (body: string, attrs?: typeof cleanAttributes) => void>> | undefined;
  const log = logger?.[level] ?? logger?.info;

  if (log) {
    log(message, cleanAttributes);
    return;
  }

  Sentry.addBreadcrumb({
    category: 'structured_log',
    level: level === 'warn' ? 'warning' : level === 'trace' ? 'debug' : level,
    message,
    data: cleanAttributes,
  });

  if (level === 'error' || level === 'fatal') {
    Sentry.captureMessage(message, {
      level: level === 'fatal' ? 'fatal' : 'error',
      tags: { structured_log: 'fallback' },
      extra: cleanAttributes,
    });
  }
}
