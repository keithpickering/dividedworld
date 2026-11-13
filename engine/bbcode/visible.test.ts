import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH, parse, type BbNode } from './parse.ts';
import { excerptText, quotedActs, visibleText, visibleWalk } from './visible.ts';

const ACT = '0f8fad5b-d9cb-469f-a165-70867728950e';
const seen = (input: string) => visibleText(parse(input));

test('formatting does not split a word: bold across "cats" reads "cats"', () => {
  assert.equal(seen('ca[b]ts[/b] and [i][color=red]dogs[/color][/i]'), 'cats and dogs');
  assert.equal(seen('[u]a[/u][s]b[/s][size=3]c[/size]'), 'abc');
});

test('a quote, code, a link and an image leave one separator and none of their words', () => {
  assert.equal(seen(`before[quote=${ACT}]cats in a quote[/quote]after`), 'before\nafter');
  assert.equal(seen('x[code]cats in code[/code]y'), 'x\ny');
  assert.equal(seen('x[url=https://a.example]cats link[/url]y'), 'x\ny');
  assert.equal(seen('x[img]https://a.example/c.png[/img]y'), 'x\ny');
});

test('a counterfeit quote is the post\'s own words; a real quote is one separator', () => {
  assert.equal(seen('a[quote=Geno]b c[/quote]d'), 'ab cd');
  assert.equal(seen('a[quote]b[/quote]d'), 'abd');
  assert.equal(seen(`a[quote=Geno user=${ACT}]b[/quote]d`), 'abd');
  assert.equal(seen(`a[quote=${ACT}]b[/quote]d`), 'a\nd');
});

test('a list\'s items are kept apart, and from the words around it', () => {
  assert.equal(seen('intro[list][*]one[*]two[/list]outro'), 'intro\none\ntwo\noutro');
  assert.equal(seen('x[list=1][*]one[*]two[/list]y'), 'x\none\ntwo\ny');
  assert.equal(seen('x[list][/list]y'), 'x\ny');
  assert.equal(seen('[list][*]a[list][*]x[/list][*]b[/list]'), '\na\nx\n\nb\n');
  assert.equal(seen(`[list][*]a[quote=${ACT}]q[/quote]b[/list]`), '\na\nb\n');
});

test('each text node is given its offset in the visible text, in drawing order', () => {
  const tree = parse(`ca[b]ts[/b] [quote=${ACT}]no[/quote][list][*]a[*][i]b[/i][/list]`);
  const { text, offsets } = visibleWalk(tree);
  const found: [string, number][] = [];
  const visit = (nodes: readonly BbNode[]) => {
    for (const n of nodes) {
      if (n.type === 'text' && offsets.has(n)) found.push([n.text, offsets.get(n)!]);
      if ('children' in n && n.type !== 'quote' && n.type !== 'url') visit(n.children);
      if (n.type === 'list') for (const item of n.items) visit(item);
    }
  };
  visit(tree);
  for (const [t, at] of found) assert.equal(text.slice(at, at + t.length), t, `${t} at ${at}`);
  assert.deepEqual(found.map(([t]) => t), ['ca', 'ts', ' ', 'a', 'b']);
  // Nothing the walk leaves out (the quote's "no") is given an offset.
  assert.equal(offsets.size, 5);
});

test('a tree far deeper than the parser makes is walked without recursion running out', () => {
  let tree: BbNode = { type: 'text', text: 'deep' };
  for (let i = 0; i < 200_000; i++) tree = { type: 'bold', children: [tree] };
  assert.equal(visibleText([tree]), 'deep');
  // The parser's own cap: past MAX_DEPTH a tag is text, and the words are kept.
  const capped = '[b]'.repeat(MAX_DEPTH + 1) + 'deep' + '[/b]'.repeat(MAX_DEPTH + 1);
  assert.equal(seen(capped), '[b]deep[/b]');
});

test('a spoiler\'s and an inline spoiler\'s words are the post\'s own', () => {
  assert.equal(seen('a[spoiler=Title]b c[/spoiler]d'), 'ab cd');
  assert.equal(seen('a[ispoiler]b[/ispoiler]c'), 'abc');
  assert.equal(seen('[spoiler][ispoiler][b]x[/b][/ispoiler] y[/spoiler]'), 'x y');
});

test('a video leaves one separator and none of its words', () => {
  assert.equal(seen('x[video]https://youtu.be/dQw4w9WgXcQ[/video]y'), 'x\ny');
  assert.equal(seen('x[youtube]dQw4w9WgXcQ[/youtube]y'), 'x\ny');
});

test('every new container is transparent, and a rule is one separator', () => {
  assert.equal(seen('a[center]b[/center][left]d[/left][right]e[/right]c'), 'abdec');
  assert.equal(seen('a[sub]b[/sub][sup]c[/sup]d'), 'abcd');
  assert.equal(seen('a[font=Arial]b[/font]c'), 'abc');
  assert.equal(seen('a[marquee]b[/marquee][glow=red]c[/glow][shadow]d[/shadow]'), 'abcd');
  assert.equal(seen('a[rainbow]b[/rainbow][highlight]c[/highlight]'), 'abc');
  assert.equal(seen('a[hr]b'), 'a\nb');
  assert.equal(seen('x[noparse][b]y[/b][/noparse]z'), 'x[b]y[/b]z');
});

test('an autolink\'s words are the post\'s own, with an offset of their own', () => {
  const tree = parse('see https://x.example/a. ok');
  const { text, offsets } = visibleWalk(tree);
  assert.equal(text, 'see https://x.example/a. ok');
  const link = tree.find((n) => n.type === 'autolink')!;
  assert.equal(offsets.get(link), 4);
  assert.equal(offsets.size, 3);
  assert.equal(seen('[ispoiler]https://x.example[/ispoiler] https://y.example'), 'https://x.example https://y.example');
});

test('the excerpt is the words of the quotes of one Act, in order, joined by a separator', () => {
  const OTHER = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
  const ex = (input: string, act = ACT) => excerptText(parse(input), act);
  assert.equal(ex(`a[quote=${ACT}]one[/quote]b[quote=${ACT}]two[/quote]`), 'one\ntwo');
  assert.equal(ex(`[quote=${OTHER}]x[/quote]`), '');
  assert.equal(ex(`[quote=${ACT}]a[quote=${OTHER}]cut[/quote]b[/quote]`), 'a\nb');
  assert.equal(ex(`[quote=${OTHER}]x[quote=${ACT}]in[/quote][/quote]`), '');
  assert.equal(ex(`[quote=${ACT.toUpperCase()}]up[/quote]`), 'up');
  assert.equal(ex(`[quote=${ACT}]a[/quote]`, ACT.toUpperCase()), 'a');
  assert.equal(ex('no quotes'), '');
});

test('visibleWalk says where the bare addresses are, in the visible text\'s own offsets, and a [url]\'s label is not one', () => {
  const body = 'See https://example.com/a and [url=https://b.example]label[/url] then [b]https://c.example/x[/b] end';
  const { text, links } = visibleWalk(parse(body));
  assert.equal(text, 'See https://example.com/a and \n then https://c.example/x end');
  assert.deepEqual(links.map((l) => text.slice(l.start, l.end)), ['https://example.com/a', 'https://c.example/x']);
  assert.deepEqual(visibleWalk(parse('no addresses [url=https://b.example]here[/url] at all')).links, []);
});

/* A cut: real quotes nested past the cap (docs/plans/2026-11-13-quote-cut-plan.md, Decision 4). */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const around = (n: number, inner: string, from = 0) => Array.from({ length: n }, (_, i) => `[quote=${ID(from + i)}]`).join('') + inner + '[/quote]'.repeat(n);

test('a cut leaves one separator, as a real quote does, and none of its words', () => {
  const bold = (inner: string) => '[b]'.repeat(MAX_DEPTH) + inner + '[/b]'.repeat(MAX_DEPTH);
  assert.equal(seen(`a${bold(`[quote=${ID(900)}]cats past the cap[quote=${ID(901)}]more[/quote][/quote]`)}b`), 'a\nb');
  assert.equal(seen(`a${bold(`[quote=${ID(900)}][/quote]`)}b`), 'a\nb');
});

test('quotedActs includes a cut\'s Acts, in the order the openers stand, each once', () => {
  const nine = ID(900), eight = ID(901);
  const body = `[quote=${ID(5)}]x[/quote]` + around(MAX_DEPTH, `[quote=${nine}]a[quote=${eight}]b[/quote][quote=${nine}]c[/quote][/quote]`, 100) + `[quote=${eight}]y[/quote]`;
  assert.deepEqual(quotedActs(parse(body)), [ID(5), ...Array.from({ length: MAX_DEPTH }, (_, i) => ID(100 + i)), nine, eight]);
  assert.deepEqual(quotedActs(parse(around(MAX_DEPTH + 3, 'x'))), Array.from({ length: MAX_DEPTH + 3 }, (_, i) => ID(i)));
});

test('the excerpt of an Act quoted only past the cap is empty, and a cut takes nothing from another Act\'s excerpt', () => {
  const deep = ID(900);
  const bold = (inner: string) => '[b]'.repeat(MAX_DEPTH) + inner + '[/b]'.repeat(MAX_DEPTH);
  assert.equal(excerptText(parse(bold(`[quote=${deep}]secret[/quote]`)), deep), '');
  assert.equal(excerptText(parse(around(MAX_DEPTH + 1, 'secret')), ID(MAX_DEPTH)), '');
  assert.equal(excerptText(parse(`${bold(`[quote=${deep}]secret[/quote]`)}[quote=${deep}]shown[/quote]`), deep), 'shown');
});

test('a bare address after a cut keeps its offsets in the visible text', () => {
  const bold = (inner: string) => '[b]'.repeat(MAX_DEPTH) + inner + '[/b]'.repeat(MAX_DEPTH);
  const { text, links } = visibleWalk(parse(`go ${bold(`[quote=${ID(900)}]cats[/quote]`)} then https://d.example/z end`));
  assert.equal(text, 'go \n then https://d.example/z end');
  assert.deepEqual(links.map((l) => text.slice(l.start, l.end)), ['https://d.example/z']);
});
