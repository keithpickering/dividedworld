/**
 * The plain words of a post, one list in two languages: each fixture in plain.fixtures.ts says what
 * `visibleText(parse(body))` gives, whitespace collapsed. supabase/tests/0117-bbcode-plain.sql, made
 * from the same list by tools/bbcode-plain.mjs, holds the database's `bbcode_plain` to the same
 * words, and tools/check-bbcode-plain.mjs holds that file to this list ("Two lists that must agree
 * are one list").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapse, PLAIN_FIXTURES } from './plain.fixtures.ts';
import { MAX_DEPTH, parse } from './parse.ts';
import { excerptText, quotedActs, visibleText } from './visible.ts';

test('the fixtures that spell out the nesting cap were written for the cap of 16', () => {
  // plain.fixtures.ts is JSON (tools/bbcode-plain.mjs reads it without a loader), so a body past the cap spells out its levels: change MAX_DEPTH and write them again
  assert.equal(MAX_DEPTH, 16);
});

test("the cap in SQL is parse.ts's MAX_DEPTH: bbcode_walk's max_depth and supabase/tests/0295-quote-past-cap.sql's cap()", () => {
  const root = new URL('../../supabase/', import.meta.url);
  const migrations = readdirSync(new URL('migrations/', root)).filter((f) => f.endsWith('.sql')).sort();
  const newest = migrations.filter((f) => /create (or replace )?function bbcode_walk\(/i.test(readFileSync(new URL(`migrations/${f}`, root), 'utf8'))).pop();
  assert.ok(newest, 'no migration defines bbcode_walk');
  const walk = /max_depth constant int := (\d+);/.exec(readFileSync(new URL(`migrations/${newest}`, root), 'utf8'));
  assert.equal(Number(walk?.[1]), MAX_DEPTH, `${newest}: bbcode_walk's max_depth`);
  const capTest = /function pg_temp\.cap\(\)[^;]*select (\d+)/.exec(readFileSync(new URL('tests/0295-quote-past-cap.sql', root), 'utf8'));
  assert.equal(Number(capTest?.[1]), MAX_DEPTH, "0295-quote-past-cap.sql's pg_temp.cap()");
});

test('there are fixtures, each named once', () => {
  assert.ok(PLAIN_FIXTURES.length >= 20);
  assert.equal(new Set(PLAIN_FIXTURES.map((f) => f.name)).size, PLAIN_FIXTURES.length);
});

for (const f of PLAIN_FIXTURES) {
  test(`plain words: ${f.name}`, () => {
    assert.equal(collapse(visibleText(parse(f.body))), f.plain);
  });
}

for (const f of PLAIN_FIXTURES) {
  if (f.excerptOf === undefined) continue;
  test(`excerpt: ${f.name}`, () => {
    assert.equal(collapse(excerptText(parse(f.body), f.excerptOf!)), f.excerpt);
  });
}

for (const f of PLAIN_FIXTURES) {
  if (f.quotes === undefined) continue;
  test(`quotes: ${f.name}`, () => {
    assert.deepEqual(quotedActs(parse(f.body)), f.quotes);
  });
}

test('a fixture names an excerpt and the Act it is of together, and some are of an Act', () => {
  for (const f of PLAIN_FIXTURES) assert.equal(f.excerptOf === undefined, f.excerpt === undefined, f.name);
  assert.ok(PLAIN_FIXTURES.filter((f) => f.excerptOf !== undefined && f.excerpt !== '').length >= 8);
  assert.ok(PLAIN_FIXTURES.filter((f) => f.excerptOf !== undefined && f.excerpt === '').length >= 4);
});

test('collapse turns each run of whitespace into one space and trims the ends', () => {
  assert.equal(collapse('  a \n\n b\t\tc  '), 'a b c');
  assert.equal(collapse(''), '');
});

/* The characters bbcode_plain_url_ok refuses are written out in supabase/migrations/0117_search.sql, because Postgres has no \p{Cf}. This reads that class back out of the
   migration and holds it, over every code point, to the parser's own answer (an image address with the character in it is refused exactly when the parser's BAD_URL_CHAR
   matches it, \p{Cf} among them), and to /\p{Cf}/u itself, so a new Unicode release in Node that adds a format character fails here until the migration carries it. */
function sqlRefusedClass(): Set<number> {
  const sql = readFileSync(new URL('../../supabase/migrations/0117_search.sql', import.meta.url), 'utf8');
  const fn = sql.slice(sql.indexOf('function bbcode_plain_url_ok'));
  const at = fn.indexOf("if s ~ '[");
  assert.ok(at >= 0, 'the refused-character class is not where the test looks');
  const start = at + "if s ~ '[".length;
  const end = fn.indexOf("]' then", start);
  assert.ok(end > start);
  const cps = Array.from(fn.slice(start, end));
  const atoms: number[] = [];
  const dash: boolean[] = [];
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i]!;
    let isDash = false;
    if (c === '\\') {
      const kind = cps[i + 1]!;
      if (kind === 'u') { atoms.push(parseInt(cps.slice(i + 2, i + 6).join(''), 16)); i += 5; }
      else if (kind === 'U') { atoms.push(parseInt(cps.slice(i + 2, i + 10).join(''), 16)); i += 9; }
      else { atoms.push(kind.codePointAt(0)!); i += 1; }
    } else if (c === "'" && cps[i + 1] === "'") { atoms.push(0x27); i += 1; }
    else if (c === '-') { atoms.push(-1); isDash = true; }
    else atoms.push(c.codePointAt(0)!);
    dash.push(isDash);
  }
  const set = new Set<number>();
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!;
    if (a === -1) continue;
    if (atoms[i + 1] === -1 && i + 2 < atoms.length) {
      for (let cp = a; cp <= atoms[i + 2]!; cp++) set.add(cp);
      i += 2;
    } else set.add(a);
  }
  return set;
}

test('the SQL list of refused address characters is exactly the parser\'s, and holds every \\p{Cf}', () => {
  const sql = sqlRefusedClass();
  const cf = /\p{Cf}/u;
  const missing: string[] = [];
  const extra: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) continue; // a Postgres text holds neither NUL nor a lone surrogate
    const ch = String.fromCodePoint(cp);
    const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    if (cf.test(ch) && !sql.has(cp)) missing.push(`${hex} is \\p{Cf} and the SQL list lacks it`);
    const parser = parse(`[img]http://a.example/x${ch}y[/img]`).some((n) => n.type === 'img') === false;
    if (parser !== sql.has(cp)) (parser ? missing : extra).push(`${hex}: the parser ${parser ? 'refuses' : 'accepts'} it and the SQL list ${sql.has(cp) ? 'refuses' : 'accepts'} it`);
  }
  assert.deepEqual(missing, [], 'in the parser or \\p{Cf} but not in the SQL list');
  assert.deepEqual(extra, [], 'in the SQL list but not the parser');
});
