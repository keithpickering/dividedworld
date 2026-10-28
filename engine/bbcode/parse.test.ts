import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH, parse, safeHref, safeImageSrc } from './parse.ts';
import type { BbNode } from './parse.ts';

const text = (t: string): BbNode => ({ type: 'text', text: t });
const ACT = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** Every input in `bad` must come back as exactly itself, as one text node. */
function assertLiteral(inputs: readonly string[]) {
  for (const input of inputs) assert.deepEqual(parse(input), [text(input)], `should be literal: ${JSON.stringify(input)}`);
}

function depthOf(nodes: readonly BbNode[]): number {
  let max = 0;
  for (const n of nodes) {
    let d = 0;
    if ('children' in n) d = 1 + depthOf(n.children);
    else if (n.type === 'list') d = 1 + n.items.reduce((m, item) => Math.max(m, depthOf(item)), 0);
    max = Math.max(max, d);
  }
  return max;
}

function allText(nodes: readonly BbNode[]): string {
  let s = '';
  for (const n of nodes) {
    if (n.type === 'text' || n.type === 'code') s += n.text;
    else if ('children' in n) s += allText(n.children);
    else if (n.type === 'list') for (const item of n.items) s += allText(item);
  }
  return s;
}

test('plain text is one text node', () => {
  assert.deepEqual(parse('hello world'), [text('hello world')]);
  assert.deepEqual(parse(''), []);
});

test('bold, italic, underline and strike wrap their contents', () => {
  assert.deepEqual(parse('[b]a[/b][i]b[/i][u]c[/u][s]d[/s]'), [
    { type: 'bold', children: [text('a')] },
    { type: 'italic', children: [text('b')] },
    { type: 'underline', children: [text('c')] },
    { type: 'strike', children: [text('d')] },
  ]);
});

test('tags nest and tag names ignore case', () => {
  assert.deepEqual(parse('x[B]a[i]b[/I]c[/b]y'), [
    text('x'),
    { type: 'bold', children: [text('a'), { type: 'italic', children: [text('b')] }, text('c')] },
    text('y'),
  ]);
});

test('HTML and unknown tags stay text', () => {
  assertLiteral(['<script>alert(1)</script>', '[spoiler]x[/spoiler]', '[b ]x[/b ]', 'a [] b', '[', ']', '[[b', '[=x]']);
});

test('color accepts named colors and hex, normalized to lowercase', () => {
  assert.deepEqual(parse('[color=Red]x[/color]'), [{ type: 'color', color: 'red', children: [text('x')] }]);
  assert.deepEqual(parse('[color=#F0a]x[/color]'), [{ type: 'color', color: '#f0a', children: [text('x')] }]);
  assert.deepEqual(parse('[color="#00FF00"]x[/color]'), [{ type: 'color', color: '#00ff00', children: [text('x')] }]);
});

test('color with anything else becomes text', () => {
  assertLiteral(['[color=expression(alert(1))]x[/color]', '[color=#12]x[/color]', '[color=url(x)]x[/color]', '[color]x[/color]', '[color=red;position:fixed]x[/color]']);
});

test('size is a whole number from 1 to 7', () => {
  assert.deepEqual(parse('[size=7]x[/size]'), [{ type: 'size', size: 7, children: [text('x')] }]);
  assert.deepEqual(parse('[size=1]x[/size]'), [{ type: 'size', size: 1, children: [text('x')] }]);
  assertLiteral(['[size=0]x[/size]', '[size=8]x[/size]', '[size=200]x[/size]', '[size=-1]x[/size]', '[size=big]x[/size]', '[size=3.5]x[/size]']);
});

test('url with an http, https, mailto or site-relative target becomes a link', () => {
  assert.deepEqual(parse('[url=https://example.com/a?b=1&c=2]go[/url]'), [
    { type: 'url', href: 'https://example.com/a?b=1&c=2', children: [text('go')] },
  ]);
  assert.deepEqual(parse('[url=mailto:a@b.co]mail[/url]'), [{ type: 'url', href: 'mailto:a@b.co', children: [text('mail')] }]);
  assert.deepEqual(parse('[url=/t/123]thread[/url]'), [{ type: 'url', href: '/t/123', children: [text('thread')] }]);
  assert.deepEqual(parse('[url=HTTP://Example.com]x[/url]'), [{ type: 'url', href: 'http://Example.com', children: [text('x')] }]);
});

test('a bare url tag uses its contents as the target', () => {
  assert.deepEqual(parse('[url]https://example.com[/url]'), [
    { type: 'url', href: 'https://example.com', children: [text('https://example.com')] },
  ]);
});

test('url with a javascript target becomes text, however it is dressed', () => {
  const targets = [
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'JAVASCRIPT:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\u0000script:alert(1)',
    '\u0001javascript:alert(1)',
    'java&#115;cript:alert(1)',
    '&#106;avascript:alert(1)',
    '&Tab;javascript:alert(1)',
    'javascript&colon;alert(1)',
    'jav&#x61;script:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    '//evil.example.com',
    '/\\evil.example.com',
    'http:evil',
    'https://',
    'mailto:',
    'example.com',
    '',
    'https://a.example/"onmouseover="alert(1)',
    'https://a.example/<b>',
    'https://a.example/​x',
    'https://a.example/‮x',
  ];
  assertLiteral(targets.map((t) => `[url=${t}]click[/url]`));
  assertLiteral(targets.map((t) => `[url="${t}"]click[/url]`));
});

test('a bare url tag around a javascript target becomes text', () => {
  assertLiteral(['[url]javascript:alert(1)[/url]', '[url] JaVaScRiPt:x[/url]', '[url]data:text/html,x[/url]']);
});

test('a bare url tag around anything but one plain target becomes its own text and keeps what is inside', () => {
  assert.deepEqual(parse('[url][b]https://example.com[/b][/url]'), [
    text('[url]'),
    { type: 'bold', children: [text('https://example.com')] },
    text('[/url]'),
  ]);
});

test('img with an http or https source becomes an image', () => {
  assert.deepEqual(parse('[img]https://example.com/a.png[/img]'), [{ type: 'img', src: 'https://example.com/a.png' }]);
  assert.deepEqual(parse('[IMG]http://example.com/a.png[/IMG]'), [{ type: 'img', src: 'http://example.com/a.png' }]);
});

test('img with a data or javascript source becomes text', () => {
  assertLiteral([
    '[img]data:image/png;base64,AAAA[/img]',
    '[img]data:text/html,<script>alert(1)</script>[/img]',
    '[img]javascript:alert(1)[/img]',
    '[img] JaVaScRiPt:alert(1)[/img]',
    '[img]java&#115;cript:alert(1)[/img]',
    '[img]vbscript:x[/img]',
    '[img]/relative.png[/img]',
    '[img]ftp://example.com/a.png[/img]',
    '[img]//evil.example.com/a.png[/img]',
    '[img][/img]',
    '[img]https://a.example/a.png"onerror="alert(1)[/img]',
  ]);
});

test('an img with no closing tag is text and the rest still parses', () => {
  assert.deepEqual(parse('[img]https://example.com/a.png [b]x[/b]'), [
    text('[img]https://example.com/a.png '),
    { type: 'bold', children: [text('x')] },
  ]);
});

test('a quote names an Act by id', () => {
  assert.deepEqual(parse(`[quote=${ACT}]hi[/quote] reply`), [{ type: 'quote', act: ACT, children: [text('hi')] }, text(' reply')]);
  assert.deepEqual(parse(`[quote="${ACT.toUpperCase()}"]hi[/quote]`), [{ type: 'quote', act: ACT, children: [text('hi')] }]);
});

test('a quote that does not name an Act by a well-formed id becomes text', () => {
  assertLiteral(['[quote]hi[/quote]', '[quote=12]hi[/quote]', '[quote=Some Name]hi[/quote]', `[quote=${ACT}x]hi[/quote]`, '[quote="><script>"]hi[/quote]']);
});

test('quotes survive nesting inside quotes and other tags', () => {
  const inner = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
  assert.deepEqual(parse(`[quote=${ACT}]a[quote=${inner}][b]deep[/b][/quote]b[/quote]`), [
    {
      type: 'quote',
      act: ACT,
      children: [
        text('a'),
        { type: 'quote', act: inner, children: [{ type: 'bold', children: [text('deep')] }] },
        text('b'),
      ],
    },
  ]);
  assert.deepEqual(parse(`[b][quote=${ACT}]x[/quote][/b]`), [
    { type: 'bold', children: [{ type: 'quote', act: ACT, children: [text('x')] }] },
  ]);
});

test('code keeps its contents as raw text', () => {
  assert.deepEqual(parse('[code][b]not bold[/b] [url=javascript:x]y[/url][/code]'), [
    { type: 'code', text: '[b]not bold[/b] [url=javascript:x]y[/url]' },
  ]);
  assert.deepEqual(parse('[CODE]a[/CODE]'), [{ type: 'code', text: 'a' }]);
});

test('code with no closing tag is text and the rest still parses', () => {
  assert.deepEqual(parse('[code]x [b]y[/b]'), [text('[code]x '), { type: 'bold', children: [text('y')] }]);
});

test('a list has items, unordered by default and ordered with =1', () => {
  assert.deepEqual(parse('[list][*]one[*]two [b]x[/b][/list]'), [
    { type: 'list', ordered: false, items: [[text('one')], [text('two '), { type: 'bold', children: [text('x')] }]] },
  ]);
  assert.deepEqual(parse('[list=1]\n[*]a\n[*]b\n[/list]'), [
    { type: 'list', ordered: true, items: [[text('a\n')], [text('b\n')]] },
  ]);
});

test('words before the first item are kept as an item, blank space is not', () => {
  assert.deepEqual(parse('[list]\n[*]a[/list]'), [{ type: 'list', ordered: false, items: [[text('a')]] }]);
  assert.deepEqual(parse('[list]intro[*]a[/list]'), [{ type: 'list', ordered: false, items: [[text('intro')], [text('a')]] }]);
});

test('an item marker outside a list is text', () => {
  assertLiteral(['[*]x', 'a [*] b']);
  assert.deepEqual(parse('[b][*]x[/b]'), [{ type: 'bold', children: [text('[*]x')] }]);
});

test('a list type other than 1 becomes text', () => {
  assertLiteral(['[list=a][*]x[/list]']);
});

test('an unclosed tag closes at the end and keeps its words', () => {
  assert.deepEqual(parse('[b]loud [i]and slanted'), [
    { type: 'bold', children: [text('loud '), { type: 'italic', children: [text('and slanted')] }] },
  ]);
  assert.deepEqual(parse('[url=https://example.com]x'), [{ type: 'url', href: 'https://example.com', children: [text('x')] }]);
  assert.deepEqual(parse('[list][*]a'), [{ type: 'list', ordered: false, items: [[text('a')]] }]);
});

test('an unclosed bare url tag falls back to its words', () => {
  assert.deepEqual(parse('[url]https://example.com'), [text('[url]https://example.com')]);
});

test('a closing tag with nothing open is text', () => {
  assertLiteral(['x[/b]y'.replace(/^/, ''), '[/quote]', '[/img]', '[/code]']);
  assert.deepEqual(parse('a[/b]b'), [text('a[/b]b')]);
});

test('badly nested tags close the inner one and the stray closer stays text', () => {
  assert.deepEqual(parse('[b][i]x[/b]y[/i]'), [
    { type: 'bold', children: [{ type: 'italic', children: [text('x')] }] },
    text('y[/i]'),
  ]);
});

test('a closer reaching past an open list closes the list safely', () => {
  assert.deepEqual(parse('[b][list][*]a[/b]z'), [
    { type: 'bold', children: [{ type: 'list', ordered: false, items: [[text('a')]] }] },
    text('z'),
  ]);
});

test('an opening tag that is turned into text takes its closer with it', () => {
  assert.deepEqual(parse('[b][color=nope]x[/color]y[/b]'), [
    { type: 'bold', children: [text('[color=nope]x[/color]y')] },
  ]);
});

test('no word a player wrote is dropped from malformed input', () => {
  const inputs = ['[b]a[i]b[/b]c[/i]d[/u]', '[url=javascript:x]a[/url] b [img]data:x[/img] c', '[quote=zz]q[/quote] [list][*]x[b]y', '[[[b]]]a[/b]]]'];
  for (const input of inputs) {
    // Letters inside tags are tag names, so the player's letters are what is left once tags are removed.
    const kept: string[] = allText(parse(input)).match(/[a-z]/g) ?? [];
    const written: string[] = input.replace(/\[[^\]]*\]/g, '').match(/[a-z]/g) ?? [];
    for (const w of written) assert.ok(kept.includes(w), `${w} lost from ${input}`);
    assert.ok(kept.length >= written.length, `letters lost from ${input}`);
  }
});

test('nesting past the depth cap turns the extra tags into text instead of recursing', () => {
  const n = 10_000;
  const started = performance.now();
  const tree = parse('[b]'.repeat(n) + 'core' + '[/b]'.repeat(n));
  const ms = performance.now() - started;
  assert.ok(depthOf(tree) <= MAX_DEPTH, `depth ${depthOf(tree)} over cap ${MAX_DEPTH}`);
  assert.ok(ms < 2000, `took ${ms}ms`);
  const text = allText(tree);
  assert.equal(text.split('[b]').length - 1, n - MAX_DEPTH);
  assert.equal(text.split('[/b]').length - 1, n - MAX_DEPTH);
  assert.ok(text.includes('core'));
});

test('a megabyte of input parses in bounded time', () => {
  const shapes: Record<string, string> = {
    mixed: '[b]bold[/b] plain [url=https://example.com]link[/url] [i]x'.repeat(20_000),
    brackets: '['.repeat(1_000_000),
    closers: '[/b]'.repeat(250_000),
    openers: '[b]'.repeat(333_333),
    unclosedCode: '[code]a'.repeat(140_000),
    unclosedImg: '[img]https://a.example/x.png'.repeat(35_000),
    badUrls: '[url=javascript:x]a'.repeat(50_000),
    longBody: '[' + 'a'.repeat(1_000_000) + ']',
    items: '[list]' + '[*]x'.repeat(250_000),
  };
  for (const [name, input] of Object.entries(shapes)) {
    const started = performance.now();
    const tree = parse(input);
    const ms = performance.now() - started;
    assert.ok(ms < 3000, `${name} took ${ms}ms`);
    assert.ok(depthOf(tree) <= MAX_DEPTH + 1, `${name} too deep`);
  }
});

test('safeHref and safeImageSrc return the checked address or null', () => {
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeImageSrc('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(safeImageSrc('/a.png'), null);
  assert.equal(safeImageSrc('mailto:a@b.co'), null);
});
