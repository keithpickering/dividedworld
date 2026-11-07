/**
 * The plain words of a post, one list in two languages: each fixture in plain.fixtures.ts says what
 * `visibleText(parse(body))` gives, whitespace collapsed. supabase/tests/0115-bbcode-plain.sql, made
 * from the same list by tools/bbcode-plain.mjs, holds the database's `bbcode_plain` to the same
 * words, and tools/check-bbcode-plain.mjs holds that file to this list ("Two lists that must agree
 * are one list").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapse, PLAIN_FIXTURES } from './plain.fixtures.ts';
import { parse } from './parse.ts';
import { visibleText } from './visible.ts';

test('there are fixtures, each named once', () => {
  assert.ok(PLAIN_FIXTURES.length >= 20);
  assert.equal(new Set(PLAIN_FIXTURES.map((f) => f.name)).size, PLAIN_FIXTURES.length);
});

for (const f of PLAIN_FIXTURES) {
  test(`plain words: ${f.name}`, () => {
    assert.equal(collapse(visibleText(parse(f.body))), f.plain);
  });
}

test('collapse turns each run of whitespace into one space and trims the ends', () => {
  assert.equal(collapse('  a \n\n b\t\tc  '), 'a b c');
  assert.equal(collapse(''), '');
});
