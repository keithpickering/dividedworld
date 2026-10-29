import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH, MAX_TAG, MAX_URL_LENGTH, parse, safeHref, safeImageSrc } from './parse.ts';
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
    'https://a.example/\u200bx',
    'https://a.example/\u202ex',
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
  assertLiteral(['x[/b]y', '[/quote]', '[/img]', '[/code]']);
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

const BAD_AUTHORITIES = [
  'https://mfgg.net@evil.example/',
  'https://user:pw@x.example/',
  'https://@',
  'https://@x.example/',
  'https://:80',
  'https://:80/path',
  'https://x.example:/',
  'https://x.example:port/',
  'https://x.example:123456/',
  'https://\u0430pple.com/',
  'https://apple.\u0441om/',
  'https://%61.example/',
  'https://a_b.example/',
  'https://-a.example/',
  'https://a..b/',
  'https://a.example./x'.replace('./x', '..'),
];

test('a link or image whose authority holds credentials, no host or a non-ASCII host is text', () => {
  assertLiteral(BAD_AUTHORITIES.map((t) => `[url=${t}]mfgg.net[/url]`));
  assertLiteral(BAD_AUTHORITIES.map((t) => `[img]${t}[/img]`));
  for (const t of BAD_AUTHORITIES) {
    assert.equal(safeHref(t), null, t);
    assert.equal(safeImageSrc(t), null, t);
  }
});

test('ordinary hosts, ports, punycode and an @ in the path are accepted', () => {
  for (const ok of [
    'https://xn--80ak6aa92e.com/',
    'https://a.example:8080/p',
    'http://localhost',
    'https://1.2.3.4/x',
    'https://a.example/@user',
    'https://a.example/?e=a@b.co',
    'https://a.example/\u00e9t\u00e9',
  ]) {
    assert.equal(safeHref(ok), ok);
    assert.equal(safeImageSrc(ok), ok);
  }
});

test('invisible characters in an address make it text', () => {
  const chars = ['\u3164', '\u2800', '\u00ad', '\u180e', '\ufff9', '\ufffa', '\ufffb', '\u200b', '\u034f', '\u115f', '\u1160', '\uffa0', '\u2062', '\ufeff'];
  for (const c of chars) {
    const code = `U+${c.codePointAt(0)?.toString(16)}`;
    assert.equal(safeHref(`https://a.example/${c}x`), null, code);
    assert.equal(safeHref(`https://a${c}.example/`), null, code);
    assert.equal(safeImageSrc(`https://a.example/${c}x.png`), null, code);
    assertLiteral([`[url=https://a.example/${c}x]t[/url]`]);
  }
});

test('an address of exactly the maximum length is a link and one longer is text', () => {
  const base = 'https://a.example/';
  const ok = base + 'a'.repeat(MAX_URL_LENGTH - base.length);
  const tooLong = ok + 'a';
  assert.equal(ok.length, MAX_URL_LENGTH);
  assert.deepEqual(parse(`[url=${ok}]t[/url]`), [{ type: 'url', href: ok, children: [text('t')] }]);
  assert.deepEqual(parse(`[url="${ok}"]t[/url]`), [{ type: 'url', href: ok, children: [text('t')] }]);
  assertLiteral([`[url=${tooLong}]t[/url]`, `[img]${tooLong}[/img]`]);
  assert.deepEqual(parse(`[img]${ok}[/img]`), [{ type: 'img', src: ok }]);
  assert.equal(safeHref(tooLong), null);
  assert.equal(safeImageSrc(tooLong), null);
});

test('a long URL that fits the maximum is a link, not text', () => {
  const href = 'https://a.example/' + 'q'.repeat(400);
  assert.deepEqual(parse(`[url=${href}]t[/url]`), [{ type: 'url', href, children: [text('t')] }]);
});

test('a tag longer than the tag limit is text and does not capture a later closer', () => {
  const long = 'x'.repeat(MAX_TAG + 1);
  assert.deepEqual(parse(`[b][b=${long}][/b]y`), [
    { type: 'bold', children: [text(`[b=${long}]`)] },
    text('y'),
  ]);
  assert.deepEqual(parse(`[b][b=x][/b]y`), [{ type: 'bold', children: [text('[b=x][/b]y')] }]);
});

test('a bad img gives up only its own opener, and what follows still parses', () => {
  assert.deepEqual(parse('[img]oops [b]b[/b] [img]https://a.b/c.png[/img]'), [
    text('[img]oops '),
    { type: 'bold', children: [text('b')] },
    text(' '),
    { type: 'img', src: 'https://a.b/c.png' },
  ]);
  assert.deepEqual(parse('[img]data:x[/img] [b]k[/b]'), [text('[img]data:x[/img] '), { type: 'bold', children: [text('k')] }]);
});

test('a code or img tag with an attribute is text and parsing resumes after it', () => {
  assert.deepEqual(parse('[code=x]a[/code]'), [text('[code=x]a[/code]')]);
  assert.deepEqual(parse('[img=x]https://a.b/c.png[/img]'), [text('[img=x]https://a.b/c.png[/img]')]);
  assert.deepEqual(parse('[code=x][b]a[/b][/code]'), [text('[code=x]'), { type: 'bold', children: [text('a')] }, text('[/code]')]);
});

test('a link opened inside a link closes the outer one there, so no anchor nests', () => {
  assert.deepEqual(parse('[url=https://a.example/1]x [url=https://b.example/2]y[/url] z[/url]'), [
    { type: 'url', href: 'https://a.example/1', children: [text('x ')] },
    { type: 'url', href: 'https://b.example/2', children: [text('y')] },
    text(' z[/url]'),
  ]);
  assert.deepEqual(parse('[url=https://a.example/][b]x[url=https://b.example/]y[/url]'), [
    { type: 'url', href: 'https://a.example/', children: [{ type: 'bold', children: [text('x')] }] },
    { type: 'url', href: 'https://b.example/', children: [text('y')] },
  ]);
});

test('a forgotten closing tag does not turn the links after it into text', () => {
  assert.deepEqual(parse('[url=https://a.example]forgot [url=https://b.example]later[/url] and [url=https://c.example]more[/url]'), [
    { type: 'url', href: 'https://a.example', children: [text('forgot ')] },
    { type: 'url', href: 'https://b.example', children: [text('later')] },
    text(' and '),
    { type: 'url', href: 'https://c.example', children: [text('more')] },
  ]);
});

test('a link that is text, or a bare link left open, does not block a link inside it', () => {
  assert.deepEqual(parse('[url=bad]a[url=https://ok.example]b[/url][/url]'), [
    text('[url=bad]a'),
    { type: 'url', href: 'https://ok.example', children: [text('b')] },
    text('[/url]'),
  ]);
  assert.deepEqual(parse('[url]a [url=https://ok.example]b[/url]'), [
    text('[url]a '),
    { type: 'url', href: 'https://ok.example', children: [text('b')] },
  ]);
});

test('an inner link whose target is bad is text and leaves the outer link open', () => {
  assert.deepEqual(parse('[url=https://a.example/]x [url=javascript:y]z[/url][/url]'), [
    { type: 'url', href: 'https://a.example/', children: [text('x [url=javascript:y]z[/url]')] },
  ]);
});

test('an image inside a link is fine', () => {
  assert.deepEqual(parse('[url=https://a.example/][img]https://a.example/i.png[/img][/url]'), [
    { type: 'url', href: 'https://a.example/', children: [{ type: 'img', src: 'https://a.example/i.png' }] },
  ]);
  assert.deepEqual(parse('[url=https://a.example/]x[/url][url=https://b.example/]y[/url]'), [
    { type: 'url', href: 'https://a.example/', children: [text('x')] },
    { type: 'url', href: 'https://b.example/', children: [text('y')] },
  ]);
});

test('a color must be a whole hex value or name, with nothing around it', () => {
  assertLiteral(['[color=#fffffff]x[/color]', '[color=#fffxyz]x[/color]', '[color=a#fff]x[/color]', '[color=#ffff]x[/color]', '[color=#fff ]x[/color]']);
});

test('a quote id must be a whole UUID, with nothing around it', () => {
  assertLiteral([`[quote=zz${ACT}]x[/quote]`, `[quote=${ACT}zz]x[/quote]`]);
});

test('a code or img tag with an attribute never reads its contents raw', () => {
  assertLiteral(['[img=x]a[/img]', '[code=x]a[/code]']);
});

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('across generated malformed input, every word a player wrote survives in order', () => {
  /* Words are capitals, and every tag, attribute and address is lowercase or a symbol, so the
     capitals of an input are exactly the player's words. They must all appear, in order, in the
     text of the tree. */
  const inner = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
  const parts = [
    '[b]', '[/b]', '[i]', '[/i]', '[u]', '[/s]', '[url=https://a.b/c]', '[url=javascript:x]', '[url]', '[/url]',
    '[img]https://a.b/c.png[/img]', '[img]data:x[/img]', '[img]', '[/img]', '[code]', '[/code]', '[code=x]',
    `[quote=${ACT}]`, `[quote=${inner}]`, '[quote=zz]', '[/quote]', '[list]', '[list=1]', '[list=a]', '[*]', '[/list]',
    '[color=red]', '[color=zz]', '[/color]', '[size=3]', '[size=99]', '[/size]', '[', ']', '[[', ']]', '[=', ' ', '\n',
    'AB', 'CD', 'EF', 'GHL', 'JK', 'MN',
  ];
  const next = rng(20261028);
  for (let n = 0; n < 500; n++) {
    let input = '';
    const len = 1 + Math.floor(next() * 25);
    for (let k = 0; k < len; k++) input += parts[Math.floor(next() * parts.length)];
    const tree = parse(input);
    const want = input.match(/[A-Z]/g) ?? [];
    const got = allText(tree).match(/[A-Z]/g) ?? [];
    let at = 0;
    for (const c of got) if (at < want.length && want[at] === c) at++;
    assert.equal(at, want.length, `words lost or reordered in ${JSON.stringify(input)}`);
    assert.ok(depthOf(tree) <= MAX_DEPTH);
  }
});

test('many bad img openers before one closer parse in bounded time', () => {
  const started = performance.now();
  const tree = parse('[img]x'.repeat(100_000) + '[/img]');
  assert.ok(performance.now() - started < 3000);
  assert.equal(allText(tree), '[img]x'.repeat(100_000) + '[/img]');
});
