import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { seedWatcherPreferences } from '../../scripts/seed-watcher-preferences-for-qa.mjs';

test('QA seed migrates preference intent without copying activity data', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-watcher-seed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, '.ritual');
  const targetRoot = path.join(root, '.ritual-qa');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.writeFile(
    path.join(sourceRoot, 'watcher_config.json'),
    JSON.stringify({ device_id: 'device-1', user_id: 'user-1', poll_interval_ms: 1000 }),
  );
  await fs.writeFile(path.join(sourceRoot, 'activity.db'), 'production activity');

  const result = await seedWatcherPreferences({ sourceRoot, targetRoot });
  const seeded = JSON.parse(await fs.readFile(result.targetPath, 'utf8'));
  assert.equal(seeded.schema_version, 2);
  assert.equal(seeded.state, 'enabled');
  assert.equal(seeded.config.device_id, 'device-1');
  await assert.rejects(fs.access(path.join(targetRoot, 'activity.db')));
});
