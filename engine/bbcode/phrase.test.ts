/**
 * The phrase matcher, one list in two languages: each fixture in phrase.fixtures.ts says whether `phraseIn(visibleText(parse(body)), phrase)` finds
 * the phrase. supabase/tests/0136-phrase.sql, made from the same list by tools/phrase-sql.mjs, holds the database's `phrase_in(bbcode_plain(body), phrase)`
 * to the same answers, and tools/check-phrase-sql.mjs holds that file to this list ("Two lists that must agree are one list").
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHRASE_FIXTURES } from './phrase.fixtures.ts';
import { occurrences, phraseIn, sameWords } from './phrase.ts';
import { parse } from './parse.ts';
import { visibleText } from './visible.ts';
import { SET_PHRASE_MOST } from '../rules/cards.ts';

test('there are fixtures, each named once, and both answers among them', () => {
  assert.ok(PHRASE_FIXTURES.length >= 30);
  assert.equal(new Set(PHRASE_FIXTURES.map((f) => f.name)).size, PHRASE_FIXTURES.length);
  assert.ok(PHRASE_FIXTURES.some((f) => f.found) && PHRASE_FIXTURES.some((f) => !f.found));
});

for (const f of PHRASE_FIXTURES) {
  test(`phrase: ${f.name}`, () => {
    assert.equal(phraseIn(visibleText(parse(f.body)), f.phrase), f.found);
  });
}

test('phraseIn is whether there is an occurrence', () => {
  assert.equal(phraseIn('cats and Cats', 'cats'), true);
  assert.deepEqual(occurrences('cats and Cats', 'cats'), [{ from: 0, to: 4 }, { from: 9, to: 13 }]);
  assert.equal(phraseIn('anything', ''), false);
  assert.equal(phraseIn('', 'cat'), false);
});

test('sameWords folds as the matcher does', () => {
  assert.equal(sameWords('Cats', 'cATS'), true);
  assert.equal(sameWords('cat', 'cats'), false);
});

/* "A letter or a digit" is JavaScript's \p{L}\p{N}. Postgres has no property classes, so supabase/migrations/0142_face_down_moves.sql writes the class out as
   `phrase_word_class()`. This reads it back out of the migration and holds it, over every code point, to /[\p{L}\p{N}]/u itself, so a Node that learns a new letter
   fails here until the migration carries it (the way plain.test.ts holds bbcode_plain_url_ok's format-character class). */
test('the migration\'s word class is \\p{L}\\p{N}, code point for code point', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0142_face_down_moves.sql', import.meta.url), 'utf8');
  const fn = sql.slice(sql.indexOf('function phrase_word_class'));
  const m = /select '\[([^\]]+)\]'/.exec(fn);
  assert.ok(m, 'the word class is not where the test looks');
  const body = m![1]!;
  assert.equal(body.replace(/\\u[0-9a-f]{4}|\\U[0-9a-f]{8}|-/g, ''), '', 'the class holds something other than code points and ranges');
  const inClass = new Set<number>();
  let i = 0;
  const cps = [...body.matchAll(/\\u([0-9a-f]{4})(-)?|\\U([0-9a-f]{8})(-)?/g)].map((x) => ({ cp: parseInt((x[1] ?? x[3])!, 16), dash: Boolean(x[2] ?? x[4]) }));
  while (i < cps.length) {
    const from = cps[i]!;
    if (from.dash) { const to = cps[i + 1]!; for (let c = from.cp; c <= to.cp; c++) inClass.add(c); i += 2; } else { inClass.add(from.cp); i += 1; }
  }
  const wordish = /[\p{L}\p{N}]/u;
  const wrong: string[] = [];
  for (let c = 0; c < 0x110000; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    if (wordish.test(String.fromCodePoint(c)) !== inClass.has(c)) wrong.push(c.toString(16));
    if (wrong.length > 10) break;
  }
  assert.deepEqual(wrong, []);
});

test('the server holds the engine\'s bound on a set phrase, in its words', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0142_face_down_moves.sql', import.meta.url), 'utf8');
  const bound = /if char_length\(phrase\) > (\d+) then raise exception '% waits for a phrase of at most (\d+) characters'/u.exec(sql);
  assert.ok(bound, 'place_set bounds a set phrase');
  assert.deepEqual([Number(bound[1]), Number(bound[2])], [SET_PHRASE_MOST, SET_PHRASE_MOST]);
});
