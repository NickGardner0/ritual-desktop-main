import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PRIVACY_SETTINGS,
  PRIVACY_SETTINGS_STORAGE_KEY,
  readPrivacySettings,
  writePrivacySettings,
} from "../lib/privacy/privacy-settings";

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage, dispatchEvent() {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    configurable: true,
  });
  return store;
}

describe("privacy settings store snapshot stability", () => {
  test("returns a stable object identity across repeated reads after write", () => {
    installMemoryLocalStorage();

    const written = writePrivacySettings({
      ...DEFAULT_PRIVACY_SETTINGS,
      consents: {
        ...DEFAULT_PRIVACY_SETTINGS.consents,
        provider_sync: true,
      },
    });

    const first = readPrivacySettings();
    const second = readPrivacySettings();

    assert.equal(first.consents.provider_sync, true);
    assert.equal(first, written);
    assert.equal(first, second);
    assert.equal(globalThis.localStorage.getItem(PRIVACY_SETTINGS_STORAGE_KEY) !== null, true);
  });

  test("returns DEFAULT_PRIVACY_SETTINGS identity when storage is empty", () => {
    installMemoryLocalStorage();

    const first = readPrivacySettings();
    const second = readPrivacySettings();

    assert.equal(first, DEFAULT_PRIVACY_SETTINGS);
    assert.equal(second, DEFAULT_PRIVACY_SETTINGS);
  });
});
