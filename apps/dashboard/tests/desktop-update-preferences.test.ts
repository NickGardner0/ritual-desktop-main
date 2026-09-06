import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearDesktopUpdatePreferencesForNewVersion,
  readDesktopUpdatePreferences,
  remindAboutDesktopUpdateLater,
  shouldSuppressDesktopUpdate,
  skipDesktopUpdateVersion,
} from '../lib/desktop-update-preferences';

function installMemoryLocalStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
}

describe('desktop update preferences', () => {
  test('suppresses a skipped version until a new release arrives', () => {
    installMemoryLocalStorage();
    skipDesktopUpdateVersion({ version: '0.2.0' });

    assert.equal(shouldSuppressDesktopUpdate({ version: '0.2.0' }), true);
    assert.equal(shouldSuppressDesktopUpdate({ version: '0.2.1' }), false);

    clearDesktopUpdatePreferencesForNewVersion({ version: '0.2.1' });
    assert.deepEqual(readDesktopUpdatePreferences(), {});
  });

  test('reminds again after the configured delay', () => {
    installMemoryLocalStorage();
    const now = 10_000;
    remindAboutDesktopUpdateLater({ version: '0.2.0' }, now, 5_000);

    assert.equal(shouldSuppressDesktopUpdate({ version: '0.2.0' }, now + 4_999), true);
    assert.equal(shouldSuppressDesktopUpdate({ version: '0.2.0' }, now + 5_000), false);
  });
});
