import type { CloudConsent, PrivacyMode } from "@ritual/shared-contracts";

export type PrivacySettings = {
  mode: PrivacyMode;
  consents: Partial<Record<CloudConsent, boolean>>;
  updatedAt: string;
};

export const PRIVACY_SETTINGS_STORAGE_KEY = "ritual.privacy.settings.v1";

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  mode: "local_only",
  consents: {
    analytics: false,
    search: false,
    ai: false,
    voice: false,
    vision: false,
    provider_sync: false,
    crash_diagnostics: false,
    product_telemetry: false,
    plaintext_sync: false,
  },
  updatedAt: "1970-01-01T00:00:00.000Z",
};

const VALID_MODES = new Set<PrivacyMode>(["local_only", "private_sync", "cloud_intelligence"]);

// useSyncExternalStore requires getSnapshot to return a stable reference when
// data has not changed. Cache by raw localStorage payload so Privacy settings
// does not infinite-loop after the first write.
let cachedRaw: string | null = null;
let cachedSettings: PrivacySettings = DEFAULT_PRIVACY_SETTINGS;

export function normalizePrivacySettings(value: unknown): PrivacySettings {
  const candidate = value && typeof value === "object" ? value as Partial<PrivacySettings> : {};
  const mode = candidate.mode && VALID_MODES.has(candidate.mode)
    ? candidate.mode
    : DEFAULT_PRIVACY_SETTINGS.mode;
  return {
    mode,
    consents: {
      ...DEFAULT_PRIVACY_SETTINGS.consents,
      ...(candidate.consents || {}),
    },
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
}

export function readPrivacySettings(): PrivacySettings {
  if (typeof window === "undefined") return DEFAULT_PRIVACY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(PRIVACY_SETTINGS_STORAGE_KEY);
    if (!raw) {
      cachedRaw = null;
      cachedSettings = DEFAULT_PRIVACY_SETTINGS;
      return cachedSettings;
    }
    if (raw === cachedRaw) {
      return cachedSettings;
    }
    cachedRaw = raw;
    cachedSettings = normalizePrivacySettings(JSON.parse(raw));
    return cachedSettings;
  } catch {
    cachedRaw = null;
    cachedSettings = DEFAULT_PRIVACY_SETTINGS;
    return cachedSettings;
  }
}

export function writePrivacySettings(settings: PrivacySettings): PrivacySettings {
  const normalized = normalizePrivacySettings({
    ...settings,
    updatedAt: new Date().toISOString(),
  });
  if (typeof window !== "undefined") {
    const raw = JSON.stringify(normalized);
    window.localStorage.setItem(PRIVACY_SETTINGS_STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedSettings = normalized;
    window.dispatchEvent(new CustomEvent("ritual:privacy-settings-changed", { detail: normalized }));
  }
  return normalized;
}

export function privacySettingsHeaders(settings = readPrivacySettings()): Record<string, string> {
  const enabledConsents = Object.entries(settings.consents)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)
    .sort();
  return {
    "X-Ritual-Privacy-Mode": settings.mode,
    "X-Ritual-Cloud-Consents": enabledConsents.join(","),
  };
}

export function isCloudIntelligenceEnabled(settings = readPrivacySettings()): boolean {
  return settings.mode === "cloud_intelligence";
}

export function hasCloudConsent(consent: CloudConsent, settings = readPrivacySettings()): boolean {
  return settings.consents[consent] === true;
}
