export const PRIVACY_MODES = ["local_only", "private_sync", "cloud_intelligence"] as const;

export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const DATA_CLASSES = [
  "account_metadata",
  "app_preferences",
  "product_telemetry",
  "crash_diagnostics",
  "habit_definition",
  "habit_log",
  "task",
  "routine",
  "calendar_event",
  "daily_note",
  "computer_activity",
  "browser_activity",
  "ocr_text",
  "screenshot",
  "health_metric",
  "location",
  "ai_content",
  "ai_memory",
  "financial",
  "provider_secret",
] as const;

export type PrivacyDataClass = (typeof DATA_CLASSES)[number];

export const CLOUD_DESTINATIONS = [
  "backend",
  "turso_cloud",
  "turso_encrypted_sync",
  "tinybird",
  "openpanel",
  "sentry",
  "openai",
  "gemini",
  "deepgram",
  "groq",
  "provider_api",
] as const;

export type CloudDestination = (typeof CLOUD_DESTINATIONS)[number];

export const CLOUD_CONSENTS = [
  "analytics",
  "search",
  "ai",
  "voice",
  "vision",
  "provider_sync",
  "crash_diagnostics",
  "product_telemetry",
  "plaintext_sync",
] as const;

export type CloudConsent = (typeof CLOUD_CONSENTS)[number];

export type PrivacyDecision = {
  allowed: boolean;
  reason: string;
};

export type PrivacyPolicyInput = {
  mode?: PrivacyMode;
  dataClass: PrivacyDataClass;
  destination: CloudDestination;
  purpose: CloudConsent | "account" | "local_api" | "encrypted_sync";
  consents?: Partial<Record<CloudConsent, boolean>>;
};

const SENSITIVE_DATA_CLASSES = new Set<PrivacyDataClass>([
  "habit_definition",
  "habit_log",
  "task",
  "routine",
  "calendar_event",
  "daily_note",
  "computer_activity",
  "browser_activity",
  "ocr_text",
  "screenshot",
  "health_metric",
  "location",
  "ai_content",
  "ai_memory",
  "financial",
  "provider_secret",
]);

const ACCOUNT_REQUIRED_CLASSES = new Set<PrivacyDataClass>([
  "account_metadata",
  "app_preferences",
]);

const MINIMAL_TELEMETRY_CLASSES = new Set<PrivacyDataClass>([
  "product_telemetry",
  "crash_diagnostics",
]);

function normalizeMode(mode: PrivacyMode | undefined): PrivacyMode {
  return mode && PRIVACY_MODES.includes(mode) ? mode : "local_only";
}

function consentEnabled(
  consents: Partial<Record<CloudConsent, boolean>> | undefined,
  consent: CloudConsent,
): boolean {
  return consents?.[consent] === true;
}

export function isSensitiveDataClass(dataClass: PrivacyDataClass): boolean {
  return SENSITIVE_DATA_CLASSES.has(dataClass);
}

export function shouldRedactAnalyticsProperty(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes("name") ||
    normalized.includes("email") ||
    normalized.includes("phone") ||
    normalized.includes("note") ||
    normalized.includes("text") ||
    normalized.includes("title") ||
    normalized.includes("url") ||
    normalized.includes("domain") ||
    normalized.includes("location") ||
    normalized.endsWith("id") ||
    normalized.includes("_id") ||
    normalized.includes("token") ||
    normalized.includes("secret")
  );
}

export function redactAnalyticsProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!properties) return undefined;

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (shouldRedactAnalyticsProperty(key)) {
      redacted[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 128) {
      redacted[key] = value.slice(0, 128);
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

export function canSendToCloud(input: PrivacyPolicyInput): PrivacyDecision {
  const mode = normalizeMode(input.mode);
  const dataClass = input.dataClass;
  const destination = input.destination;
  const purpose = input.purpose;
  const consents = input.consents;

  if (destination === "backend" && purpose === "account" && ACCOUNT_REQUIRED_CLASSES.has(dataClass)) {
    return { allowed: true, reason: "account-required metadata" };
  }

  if (destination === "turso_encrypted_sync" || purpose === "encrypted_sync") {
    if (mode === "private_sync" || mode === "cloud_intelligence") {
      return { allowed: true, reason: "encrypted sync mode" };
    }
    return { allowed: false, reason: "encrypted sync is not enabled in Local Only mode" };
  }

  if (mode === "local_only") {
    if (MINIMAL_TELEMETRY_CLASSES.has(dataClass)) {
      const consent =
        dataClass === "crash_diagnostics" ? "crash_diagnostics" : "product_telemetry";
      return consentEnabled(consents, consent)
        ? { allowed: true, reason: `${consent} consent enabled` }
        : { allowed: false, reason: `${consent} consent is required in Local Only mode` };
    }
    if (isSensitiveDataClass(dataClass)) {
      return { allowed: false, reason: "sensitive data is local-only by default" };
    }
  }

  if (mode === "private_sync" && isSensitiveDataClass(dataClass)) {
    if (destination === "turso_cloud" || destination === "tinybird") {
      return { allowed: false, reason: "Private Sync only permits encrypted envelope sync" };
    }
  }

  if (purpose !== "account" && purpose !== "local_api") {
    if (!consentEnabled(consents, purpose)) {
      return { allowed: false, reason: `${purpose} consent is required` };
    }
  }

  return { allowed: true, reason: "policy permits destination" };
}
