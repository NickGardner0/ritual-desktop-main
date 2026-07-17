const STORAGE_KEY = 'ritual-desktop-update-preferences';
const DEFAULT_REMIND_LATER_MS = 24 * 60 * 60 * 1000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DesktopUpdatePreferenceTarget {
  version: string;
}

export interface DesktopUpdatePreferences {
  skippedVersion?: string;
  remindVersion?: string;
  remindAfter?: number;
}

function getStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function readDesktopUpdatePreferences(
  storage: StorageLike | null = getStorage(),
): DesktopUpdatePreferences {
  if (!storage) return {};

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as DesktopUpdatePreferences;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeDesktopUpdatePreferences(
  preferences: DesktopUpdatePreferences,
  storage: StorageLike | null = getStorage(),
) {
  if (!storage) return;

  try {
    if (!preferences.skippedVersion && !preferences.remindVersion && !preferences.remindAfter) {
      storage.removeItem(STORAGE_KEY);
      return;
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Updater preferences are best-effort when local storage is unavailable.
  }
}

export function shouldSuppressDesktopUpdate(
  update: DesktopUpdatePreferenceTarget,
  now = Date.now(),
  preferences = readDesktopUpdatePreferences(),
) {
  if (preferences.skippedVersion === update.version) return true;

  return (
    preferences.remindVersion === update.version &&
    typeof preferences.remindAfter === 'number' &&
    preferences.remindAfter > now
  );
}

export function skipDesktopUpdateVersion(update: DesktopUpdatePreferenceTarget) {
  writeDesktopUpdatePreferences({ skippedVersion: update.version });
}

export function remindAboutDesktopUpdateLater(
  update: DesktopUpdatePreferenceTarget,
  now = Date.now(),
  delayMs = DEFAULT_REMIND_LATER_MS,
) {
  writeDesktopUpdatePreferences({
    remindVersion: update.version,
    remindAfter: now + delayMs,
  });
}

export function clearDesktopUpdatePreferencesForNewVersion(
  update: DesktopUpdatePreferenceTarget,
) {
  const preferences = readDesktopUpdatePreferences();
  const nextPreferences = { ...preferences };
  let changed = false;

  if (preferences.skippedVersion && preferences.skippedVersion !== update.version) {
    nextPreferences.skippedVersion = undefined;
    changed = true;
  }

  if (preferences.remindVersion && preferences.remindVersion !== update.version) {
    nextPreferences.remindVersion = undefined;
    nextPreferences.remindAfter = undefined;
    changed = true;
  }

  if (changed) writeDesktopUpdatePreferences(nextPreferences);
}
