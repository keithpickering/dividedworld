/**
 * The tour's keys are one list ("Two lists that must agree are one list"): `TOUR_KEYS` here, the fake's `replayTour` (which imports it), and
 * the SQL `replay_tour`, which cannot import it and so is read from the latest migration that defines it. A tour step added here and not
 * there would leave Replay the HUD tour unable to replay it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TIP_KEYS, TOUR_KEYS } from './keys.ts';

const MIGRATIONS = 'supabase/migrations';

/** The tour keys the latest `replay_tour` removes, in its own order. */
function sqlTourKeys(files: readonly { name: string; text: string }[]): string[] {
  const defining = [...files].sort((a, b) => a.name.localeCompare(b.name)).filter((f) => /function\s+replay_tour\s*\(/.test(f.text));
  const last = defining.at(-1);
  if (!last) throw new Error('no migration defines replay_tour');
  const body = last.text.slice(last.text.search(/function\s+replay_tour\s*\(/));
  const list = /<>\s*all\s*\(\s*array\[([^\]]*)\]/.exec(body);
  if (!list) throw new Error(`${last.name}: replay_tour names no array of tour keys`);
  return [...(list[1] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
}

test('the SQL replay_tour forgets exactly the engine\'s tour keys', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).map((name) => ({ name, text: fs.readFileSync(path.join(MIGRATIONS, name), 'utf8') }));
  assert.deepEqual(sqlTourKeys(files), [...TOUR_KEYS]);
});

test('the reader is driven red by a replay_tour that forgets a different list', () => {
  const poisoned = [{ name: '0001_x.sql', text: "create function replay_tour() as $$ where k <> all (array['tour-plate', 'tour-orbs']) $$;" }];
  assert.notDeepEqual(sqlTourKeys(poisoned), [...TOUR_KEYS]);
  assert.throws(() => sqlTourKeys([{ name: '0001_x.sql', text: 'create function other() as $$ $$;' }]), /no migration defines replay_tour/);
});

test('every tour key is a tip key', () => {
  for (const k of TOUR_KEYS) assert.ok((TIP_KEYS as readonly string[]).includes(k), k);
});
