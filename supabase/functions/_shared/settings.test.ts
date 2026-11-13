import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDatabaseSettings } from './settings.ts';
import { instance } from './instance.ts';
import type { Db } from './rpc.ts';

// What the settings rows hold: the instance's own economy and the rows an admin tuned.
const rowsWith = (tuned: Record<string, unknown>): Db => ({
  rpc: (async () => ({ economy: instance.settings.economy, ...tuned })) as Db['rpc'],
});

test('rows that put the window at or below the floor do not stop the instance (design section 4)', async () => {
  for (const [window, floor] of [[64, 256], [256, 256], [270, 256]]) {
    const tuned = await withDatabaseSettings(instance, rowsWith({ oldVoiceWindow: window, oldVoicePromptFloor: floor }));
    assert.equal(tuned.settings.oldVoiceWindow, window);
    assert.equal(tuned.settings.oldVoicePromptFloor, floor);
  }
});

test('a row out of its own bounds still stops the instance, in its own words', async () => {
  await assert.rejects(withDatabaseSettings(instance, rowsWith({ oldVoiceWindow: 63 })), /setting "oldVoiceWindow" is 63/);
});
