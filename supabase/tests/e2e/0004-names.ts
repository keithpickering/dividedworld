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
  'ＷＩＤＥ', 'Ŀuigi', 'ǈ', 'PipewrenchI', 'Pipewrenchl', 'Za\u0301\u0328', 'Za\u0328\u0301', '\ud55c', 'X\u{16D68}',
  '\uabff', '\uac00', '\ud7a3', '\ud7a4', '\u0301\u0328a', 'a\u0300\u0301', 'a\u0301\u0300',
];

test('the client\'s name keys are the database\'s, name by name', () => {
  const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
  for (const [fn, key] of [['name_skeleton', 'folded'], ['name_look', 'look']] as const) {
    const rows = sql(`select string_agg(encode(convert_to(${fn}(convert_from(decode(n, 'hex'), 'UTF8')), 'UTF8'), 'hex'), ',' order by i)
      from unnest(array[${NAMES.map((n) => `'${hex(n)}'`).join(', ')}]) with ordinality as x(n, i)`).split(',');
    NAMES.forEach((n, i) => assert.equal(rows[i], hex(nameKeys(n)[key]), `${n}: the database's ${fn} and the client's ${key} disagree`));
  }
});

test('the client\'s keys are the database\'s for every code point that decomposes or has a class, for Hangul, and across the folds', () => {
  // Every decomposition and combining class, where a platform's own normalizing would differ;
  // every fifth mapping of the folds, whose lookup is one code path on each side.
  const points = new Set<string>();
  for (const [k, v] of Object.entries(NAME_FOLDS.decompose)) { points.add(k); for (const c of v) points.add(c); }
  for (const k of Object.keys(NAME_FOLDS.ccc)) points.add(k);
  for (const table of [NAME_FOLDS.fold, NAME_FOLDS.confusable]) {
    Object.entries(table).forEach(([k, v], i) => { if (i % 5 === 0) { points.add(k); for (const c of v) points.add(c); } });
  }
  for (let c = 0xac00; c <= 0xd7a3; c += 37) points.add(String.fromCodePoint(c));
  // Each after an A, so a mark has a letter before it.
  const names = [...points].map((c) => `A${c}`);
  const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
  const got = sql(`select string_agg(encode(convert_to(name_skeleton(n) || '|' || name_look(n), 'UTF8'), 'hex'), ',' order by i)
    from unnest(array[${names.map((n) => `convert_from(decode('${hex(n)}', 'hex'), 'UTF8')`).join(', ')}]) with ordinality as x(n, i)`).split(',');
  const wrong = names.filter((n, i) => got[i] !== hex(`${nameKeys(n).folded}|${nameKeys(n).look}`));
  assert.deepEqual(wrong.slice(0, 5).map((n) => [...n].map((c) => c.codePointAt(0)!.toString(16))), [], `${wrong.length} of ${names.length} disagree`);
});

test('the database\'s copy of the data is the client\'s release', () => {
  assert.equal(sql(`select version from unicode_data where what = 'confusables'`), NAME_FOLDS.unicode);
  assert.equal(sql(`select version from unicode_data where what = 'case folding'`), NAME_FOLDS.caseFolding);
  assert.equal(sql(`select source_sha256 from unicode_data where what = 'unicode data'`), NAME_FOLDS.unicodeDataSha256);
});
