import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from './parse.ts';
import type { BbNode } from './parse.ts';

/*
 * conceal_quotes (supabase/migrations/0236_conduct.sql) empties the contents of every quote of a hidden post by reading a body the way parse.ts does. This runs the
 * corpus that supabase/tests/0164-conduct-leaks.sql runs through that function through the parser: the body the SQL is expected to return must parse to exactly the
 * parser's own tree of the body with the children of each quote of the hidden post emptied. The two readings share one file, so neither can move alone.
 */
const HIDDEN = '11111111-1111-4111-8111-111111111111';
const SHOWN = '22222222-2222-4222-8222-222222222222';
const corpus = JSON.parse(fs.readFileSync(new URL('../../supabase/tests/data/conduct-quote-corpus.json', import.meta.url), 'utf8')) as { name: string; body: string; expect: string }[];
const fill = (s: string) => s.replaceAll('{H}', HIDDEN).replaceAll('{S}', SHOWN);

/** A tree with the contents of each quote of the hidden post emptied, however deep. */
function emptied(nodes: readonly BbNode[]): BbNode[] {
  return nodes.map((n): BbNode => {
    if (n.type === 'quote' && n.act === HIDDEN) return { ...n, children: [] };
    if (n.type === 'list') return { ...n, items: n.items.map(emptied) };
    return 'children' in n ? ({ ...n, children: emptied(n.children) } as BbNode) : n;
  });
}

test('the corpus is not empty and every case names a hidden quote or says why not', () => {
  assert.ok(corpus.length >= 30);
});

for (const c of corpus) {
  test(`the parser's quotes agree with conceal_quotes: ${c.name}`, () => {
    assert.deepEqual(parse(fill(c.expect)), emptied(parse(fill(c.body))));
  });
}

test('the corpus has a case where the parser does hide a quote, and one where it does not', () => {
  const emptiedSome = corpus.filter((c) => JSON.stringify(emptied(parse(fill(c.body)))) !== JSON.stringify(parse(fill(c.body))));
  assert.ok(emptiedSome.length > 20 && emptiedSome.length < corpus.length);
  for (const c of corpus) assert.equal(fill(c.expect) === fill(c.body), !emptiedSome.includes(c), c.name);
});

test('the parser measures a quote name in UTF-16 units, as bb_quote_head must (the SQL file asserts the same names)', () => {
  const kind = (name: string) => (parse(`[quote=${name}]x[/quote]`)[0] as BbNode).type;
  assert.equal(kind('\u{1F600}'.repeat(40)), 'counterfeit');
  assert.equal(kind('\u{1F600}'.repeat(41)), 'text');
  assert.equal(kind('x'.repeat(79) + '\u{1F600}'), 'text');
  assert.equal(kind('x'.repeat(79) + 'y'), 'counterfeit');
  assert.equal(kind('x'.repeat(80)), 'counterfeit');
  assert.equal(kind('x'.repeat(81)), 'text');
});
