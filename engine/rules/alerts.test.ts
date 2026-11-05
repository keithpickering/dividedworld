import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ALERT_KINDS, WRITTEN_KINDS, DERIVED_KINDS, EVERYONE_KINDS, RULING_SUBS, isWritten, isForEveryone } from './alerts.ts';

// The alerts design, section 2's catalog, as the plan's Task 3 names its keys.
const catalog = ['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'settlement', 'hint', 'followed', 'update', 'seasonNews', 'ruling', 'cardEnded'];

test('the catalog holds the design\'s kinds, each once', () => {
  assert.deepEqual([...ALERT_KINDS].sort(), [...catalog].sort());
  assert.equal(new Set(ALERT_KINDS).size, ALERT_KINDS.length);
});

test('written, derived and everyone\'s kinds partition the catalog: every kind is in exactly one', () => {
  const sets = [WRITTEN_KINDS, DERIVED_KINDS, EVERYONE_KINDS];
  for (const kind of ALERT_KINDS) {
    const holding = sets.filter((s) => (s as readonly string[]).includes(kind));
    assert.equal(holding.length, 1, `${kind} is in ${holding.length} of the three sets`);
  }
  const all = sets.flat();
  assert.equal(all.length, ALERT_KINDS.length, 'a set holds a kind the catalog does not');
  assert.deepEqual([...all].sort(), [...ALERT_KINDS].sort());
});

test('the settlement and followed threads are derived when read, never stored; everyone gets an update and season news', () => {
  assert.deepEqual([...WRITTEN_KINDS].sort(), ['cardEnded', 'cardOnYours', 'hint', 'quote', 'ruling', 'trapSprang', 'trapStruck']);
  assert.deepEqual([...DERIVED_KINDS].sort(), ['followed', 'settlement']);
  assert.deepEqual([...EVERYONE_KINDS].sort(), ['seasonNews', 'update']);
  assert.equal(isWritten('quote'), true);
  assert.equal(isWritten('settlement'), false);
  assert.equal(isWritten('update'), false);
  assert.equal(isForEveryone('update'), true);
  assert.equal(isForEveryone('hint'), false);
});

test('no ruling has a build yet, so none has a sub-key', () => {
  assert.deepEqual([...RULING_SUBS], []);
});

test('the kinds in TypeScript are the kinds the toast choice accepts, in the column\'s check, set_preferences and the toastDefaults setting (the lists are one list)', () => {
  const sql = fs.readFileSync(path.join(import.meta.dirname, '../../supabase/migrations/0092_card_end.sql'), 'utf8');
  const lists = [...sql.matchAll(/array\[((?:'[A-Za-z]+',?\s*)+)\]/g)].map((m) => [...m[1]!.matchAll(/'([A-Za-z]+)'/g)].map((k) => k[1]!).sort());
  /* 0092 redefines the check, set_preferences and settings_held with cardEnded added; its other arrays are spans and setting keys. */
  const kindLists = lists.filter((l) => l.includes('quote'));
  assert.equal(kindLists.length, 3, 'the check, the function and the setting each list the kinds');
  for (const list of kindLists) assert.deepEqual(list, [...ALERT_KINDS].sort());
});
