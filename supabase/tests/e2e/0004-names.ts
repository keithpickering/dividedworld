/**
 * End to end: the client's copy of the name folds (engine/rules/names.ts) gives the keys the
 * database gives (supabase/migrations/0011_names.sql's name_skeleton and name_look), so a name a
 * player is told is free is one the database takes, on names chosen to reach every step of the
 * folding. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './psql-db.ts';
import { nameKeys } from '../../../engine/rules/names.ts';
import { NAME_FOLDS } from '../../../engine/rules/name-folds.data.ts';

const NAMES = [
  'Pipewrench', 'PIPEWRENCH', 'Pipewrеnch', 'Ріpewrench', 'B0b', 'Café', 'Café', 'Straße', 'STRASSE',
  'ǅungla', 'ﬁre', 'Ⅻ', '\u{1d401}\u{1d428}\u{1d425}\u{1d41d}', 'Ꭺmy', 'ΑΣΚ', 'İstanbul', 'Ⓜario', 'mañana',
  'ＷＩＤＥ', 'Ŀuigi', 'ǈ', 'PipewrenchI', 'Pipewrenchl',
];

test('the client\'s name keys are the database\'s, name by name', () => {
  const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
  for (const [fn, key] of [['name_skeleton', 'folded'], ['name_look', 'look']] as const) {
    const rows = sql(`select string_agg(encode(convert_to(${fn}(convert_from(decode(n, 'hex'), 'UTF8')), 'UTF8'), 'hex'), ',' order by i)
      from unnest(array[${NAMES.map((n) => `'${hex(n)}'`).join(', ')}]) with ordinality as x(n, i)`).split(',');
    NAMES.forEach((n, i) => assert.equal(rows[i], hex(nameKeys(n)[key]), `${n}: the database's ${fn} and the client's ${key} disagree`));
  }
});

test('the database\'s copy of the data is the client\'s release', () => {
  assert.equal(sql(`select version from unicode_data where what = 'confusables'`), NAME_FOLDS.unicode);
  assert.equal(sql(`select version from unicode_data where what = 'case folding'`), NAME_FOLDS.caseFolding);
});
