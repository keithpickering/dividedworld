import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH, parse } from './parse.ts';
import { visibleText, visibleWalk } from './visible.ts';

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

test('a list\'s items are kept apart, and from the words around it', () => {
  assert.equal(seen('intro[list][*]one[*]two[/list]outro'), 'intro\none\ntwo\noutro');
});

test('each text node is given its offset in the visible text, in drawing order', () => {
  const tree = parse(`ca[b]ts[/b] [quote=${ACT}]no[/quote][list][*]a[*][i]b[/i][/list]`);
  const { text, offsets } = visibleWalk(tree);
  const found: [string, number][] = [];
  const visit = (nodes: typeof tree) => {
    for (const n of nodes) {
      if (n.type === 'text' && offsets.has(n)) found.push([n.text, offsets.get(n)!]);
      if ('children' in n && n.type !== 'quote' && n.type !== 'url') visit(n.children);
      if (n.type === 'list') for (const item of n.items) visit(item);
    }
  };
  visit(tree);
  for (const [t, at] of found) assert.equal(text.slice(at, at + t.length), t, `${t} at ${at}`);
  assert.deepEqual(found.map(([t]) => t), ['ca', 'ts', ' ', 'a', 'b']);
});

test('the deepest nesting the parser keeps is walked without recursion running out', () => {
  const deep = '[b]'.repeat(MAX_DEPTH + 5) + 'deep' + '[/b]'.repeat(MAX_DEPTH + 5);
  assert.match(seen(deep), /deep/);
});
