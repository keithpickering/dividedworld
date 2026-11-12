import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { concealQuotes } from './conceal.ts';

/*
 * The corpus that holds bbcode_walk's `unquoted` (supabase/migrations/0340_conduct.sql) to the one parser's reading of a quote
 * (supabase/tests/0168-conduct-concealing.sql asserts it in SQL). Each body is written with numbered marker words (mk1, mk2, ...), and `removed` is every marker
 * concealQuotes took out of it with every id hidden: the words of a real quote, closed or not, inside other tags or nested, and none of a counterfeit one. The database reads
 * the same bodies; no marker in `removed` may survive in what its walk calls unquoted.
 *
 * The file is generated here and held to a fresh generation by the test below ("Two lists that must agree are one list"):
 *   KAYFABB_WRITE_UNQUOTED_CORPUS=1 node --experimental-strip-types --no-warnings engine/bbcode/unquoted-corpus.test.ts
 */
const FILE = new URL('../../supabase/tests/data/unquoted-corpus.json', import.meta.url);
const H = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const ALL = new Set([H, S]);

/** A body written with `W` standing for the next marker word. */
function mark(template: string): { body: string; markers: string[] } {
  const markers: string[] = [];
  const body = template.replaceAll('W', () => { const m = `mk${markers.length + 1}x`; markers.push(m); return m; });
  return { body, markers };
}

const STRUCTURED = [
  'W [quote=H]W W[/quote] W',
  'W [quote=H]W W',
  'W [quote=H]W [b]W[/b] W',
  '[b][quote=H]W[/b] W',
  '[b]W [quote=H]W[/b] W[/quote] W',
  '[i][b][quote=H]W[/i] W[/b] W[/quote] W',
  '[url=https://e.com/]W [quote=H]W[/url] W[/quote] W',
  '[quote=H]W [quote=S]W[/quote] W[/quote] W',
  '[quote=H]W [quote=S]W [quote=H]W[/quote] W[/quote] W[/quote] W',
  '[quote=H]W [quote=S]W W',
  '[quote=H]W[quote=S]W[/quote]',
  '[quote=H]W [/b] W[/quote] W',
  '[quote=H]W [/quote] W [/quote] W',
  '[quote=H]W[/quote][quote=S]W[/quote]W',
  '[quote=H]W[/quote][quote=S]W',
  'W [quote=zz]W[/quote] W',
  'W [quote=zz]W [quote=H]W[/quote] W',
  '[quote=zz]W [quote=H]W [/quote] W [/quote] W',
  '[quote]W[/quote] W',
  '[quote=Bob]W [quote=H]W[/quote]',
  '[code][quote=H]W[/quote][/code] W',
  '[code][quote=H]W[/code] W [/quote] W',
  '[noparse][quote=H]W[/quote][/noparse] W',
  '[quote=H][noparse]W [/quote] W[/noparse]W[/quote] W',
  '[quote=H][code]W [/quote] W[/code] W[/quote] W',
  '[quote="H"]W[/quote] W',
  '[QUOTE=H]W[/QUOTE] W',
  '[quote=H]W[/QUOTE]W',
  '[quote=H user=S]W[/quote] W',
  '[quote=H]W[/quote] [quote=H]W [b]W[/quote] W[/b]',
  '[b][b][b][b][b][b][b][b][b][b][b][b][quote=H]W[/quote]W',
  '[spoiler=x][quote=H]W[/spoiler] W[/quote] W',
  '[list][*][quote=H]W[*]W[/quote][/list] W',
  '[list][*]W[quote=H]W[/list] W',
  '[img]https://e.com/a.png[/img][quote=H]W[/quote]W',
  '[url][quote=H]W[/quote][/url] W',
  '[url]https://e.com/[/url][quote=H]W',
];

const PIECES = [
  '[quote=H]', '[quote=S]', '[quote=zz]', '[quote]', '[/quote]', '[b]', '[/b]', '[i]', '[/i]', '[url=https://e.com/]', '[/url]', '[code]', '[/code]', '[noparse]', '[/noparse]',
  '[ispoiler]', '[/ispoiler]', '[list]', '[*]', '[/list]', 'W', 'W', 'W', ' ', '[', ']',
];
function lcg(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function generate(): { name: string; body: string; removed: string[] }[] {
  const out: { name: string; body: string; removed: string[] }[] = [];
  const add = (name: string, template: string) => {
    const { body, markers } = mark(template.replaceAll('[quote=H', `[quote=${H}`).replaceAll('[QUOTE=H', `[QUOTE=${H}`).replaceAll('[quote="H"', `[quote="${H}"`).replaceAll('user=S', `user=${S}`)
      .replaceAll('[quote=S', `[quote=${S}`));
    const kept = concealQuotes(body, ALL);
    out.push({ name, body, removed: markers.filter((m) => !kept.includes(m)) });
  };
  STRUCTURED.forEach((t, i) => add(`structured ${i + 1}: ${t}`, t));
  const rnd = lcg(31);
  for (let k = 0; k < 600; k++) {
    const n = 2 + Math.floor(rnd() * 14);
    add(`random ${k + 1}`, Array.from({ length: n }, () => PIECES[Math.floor(rnd() * PIECES.length)]).join(''));
  }
  return out;
}

test('the corpus holds bodies whose quotes hide words, closed or not, inside other tags and nested, and some that hide none', () => {
  const c = generate();
  const removes = (prefix: string) => (c.find((x) => x.name.startsWith(prefix))?.removed.length ?? 0) > 0;
  assert.ok(c.length >= 600);
  assert.ok(c.filter((x) => x.removed.length > 0).length > 100 && c.filter((x) => x.removed.length === 0).length > 20);
  assert.ok(removes('structured 3:') && removes('structured 4:') && removes('structured 8:'), 'unclosed, inside another tag and nested quotes remove words');
  assert.equal(c.find((x) => x.name.startsWith('structured 16:'))?.removed.length, 0, 'a counterfeit quote removes nothing');
  assert.equal(new Set(c.map((x) => x.name)).size, c.length);
});

test('supabase/tests/data/unquoted-corpus.json is what the generator makes now', () => {
  const fresh = JSON.stringify(generate(), null, 1) + '\n';
  if (process.env.KAYFABB_WRITE_UNQUOTED_CORPUS) fs.writeFileSync(FILE, fresh);
  assert.equal(fs.readFileSync(FILE, 'utf8'), fresh, 'regenerate it: KAYFABB_WRITE_UNQUOTED_CORPUS=1 node --experimental-strip-types --no-warnings engine/bbcode/unquoted-corpus.test.ts');
});
