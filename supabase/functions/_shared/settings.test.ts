import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseSettingsProblems, withDatabaseSettings } from './settings.ts';
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

// The 27 Nov incident (docs/plans/2026-11-27-release-order-design.md, section 0 and D4): rows from a newer release hold a modBots field this code does not know.
const newerModBots = { ...instance.settings.modBots, aFieldFromANewerRelease: 15 };

test('rows with a field the code does not know read whole under withDatabaseSettings: dropped, and its path logged without its value', async () => {
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warned.push(args.join(' ')); };
  try {
    const tuned = await withDatabaseSettings(instance, rowsWith({ modBots: newerModBots }));
    assert.deepEqual(tuned.settings.modBots, instance.settings.modBots);
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1, 'once per call');
  assert.match(warned[0]!, /modBots\.aFieldFromANewerRelease/);
  assert.doesNotMatch(warned[0]!, /\b15\b/, 'the path only, never a value');
});

test('a row missing a field the code needs still stops the instance: the drop never fills', async () => {
  const { quizWriteMinutes: _gone, ...row } = instance.settings.modBots;
  await assert.rejects(withDatabaseSettings(instance, rowsWith({ modBots: { ...row, aFieldFromANewerRelease: 1 } })), /"quizWriteMinutes" is not/);
});

test('databaseSettingsProblems reports an unknown field under report, and reads it whole under drop', async () => {
  const report = await databaseSettingsProblems(instance, rowsWith({ modBots: newerModBots }), { unknownFields: 'report' });
  assert.ok(report.problems.some((p) => p.includes('aFieldFromANewerRelease')), report.problems.join('\n'));
  const drop = await databaseSettingsProblems(instance, rowsWith({ modBots: newerModBots }), { unknownFields: 'drop' });
  assert.deepEqual(drop.problems, []);
});

test('two dropped fields give one warning naming both paths and neither value', async () => {
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warned.push(args.join(' ')); };
  try {
    await withDatabaseSettings(instance, rowsWith({ modBots: { ...instance.settings.modBots, firstNewField: 4242 }, apology: { ...instance.settings.apology, secondNewField: 9191 } }));
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0]!, /modBots\.firstNewField/);
  assert.match(warned[0]!, /apology\.secondNewField/);
  assert.doesNotMatch(warned[0]!, /4242|9191/);
});
