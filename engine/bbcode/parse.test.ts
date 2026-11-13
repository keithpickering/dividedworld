import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BBCODE_TAGS, MAX_DEPTH, MAX_TAG, MAX_URL_LENGTH, parse, safeHref, safeImageSrc } from './parse.ts';
import type { BbNode, QuoteSpan } from './parse.ts';
import { visibleText } from './visible.ts';

const text = (t: string): BbNode => ({ type: 'text', text: t });
const ACT = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** The tree with each autolink put back as the text it was written as, so a test of the other tags does not see links. */
function unlinked(input: string): BbNode[] {
  const walk = (nodes: readonly BbNode[]): BbNode[] => {
    const out: BbNode[] = [];
    for (const n of nodes) {
      const back: BbNode = n.type === 'autolink' ? { type: 'text', text: n.text } : 'children' in n ? { ...n, children: walk(n.children) } : n.type === 'list' ? { ...n, items: n.items.map(walk) } : n;
      const last = out[out.length - 1];
      if (back.type === 'text' && last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + back.text };
      else out.push(back);
    }
    return out;
  };
  return walk(parse(input));
}

/** Every input in `bad` must come back as exactly itself, as one text node. */
function assertLiteral(inputs: readonly string[]) {
  for (const input of inputs) assert.deepEqual(unlinked(input), [text(input)], `should be literal: ${JSON.stringify(input)}`);
}

function depthOf(nodes: readonly BbNode[]): number {
  let max = 0;
  for (const n of nodes) {
    let d = 0;
    if ('children' in n) d = 1 + depthOf(n.children);
    else if (n.type === 'cut') d = 1;
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
  assertLiteral(['<script>alert(1)</script>', '[blink]x[/blink]', '[b ]x[/b ]', 'a [] b', '[', ']', '[[b', '[=x]']);
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
  assert.deepEqual(unlinked('[url][b]https://example.com[/b][/url]'), [
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
  assert.deepEqual(unlinked('[img]https://example.com/a.png [b]x[/b]'), [
    text('[img]https://example.com/a.png '),
    { type: 'bold', children: [text('x')] },
  ]);
});

test('a quote names an Act by id', () => {
  assert.deepEqual(parse(`[quote=${ACT}]hi[/quote] reply`), [{ type: 'quote', act: ACT, children: [text('hi')] }, text(' reply')]);
  assert.deepEqual(parse(`[quote="${ACT.toUpperCase()}"]hi[/quote]`), [{ type: 'quote', act: ACT, children: [text('hi')] }]);
});

const USER = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const fake = (name: string | null, user: string | null, ...children: BbNode[]): BbNode => ({ type: 'counterfeit', name, user, children });

test('a quote with a name that is not an Act id is a counterfeit', () => {
  assert.deepEqual(parse('[quote=Geno]hi[/quote]'), [fake('Geno', null, text('hi'))]);
  assert.deepEqual(parse('[quote="Geno Wario"]hi[/quote]'), [fake('Geno Wario', null, text('hi'))]);
  assert.deepEqual(parse('[quote=Geno Wario]hi[/quote]'), [fake('Geno Wario', null, text('hi'))]);
  assert.deepEqual(parse('[quote=12]hi[/quote]'), [fake('12', null, text('hi'))]);
  assert.deepEqual(parse(`[quote=${ACT}x]hi[/quote]`), [fake(`${ACT}x`, null, text('hi'))]);
  assert.deepEqual(parse('[quote="><script>"]hi[/quote]'), [fake('><script>', null, text('hi'))]);
});

test('a counterfeit may name a character by id, with or without a typed name', () => {
  assert.deepEqual(parse(`[quote=Geno user=${USER.toUpperCase()}]hi[/quote]`), [fake('Geno', USER, text('hi'))]);
  assert.deepEqual(parse(`[quote="Geno Wario" user=${USER}]hi[/quote]`), [fake('Geno Wario', USER, text('hi'))]);
  assert.deepEqual(parse(`[quote user=${USER}]hi[/quote]`), [fake(null, USER, text('hi'))]);
  assert.deepEqual(parse('[quote]hi[/quote]'), [fake(null, null, text('hi'))]);
});

test('user= is found after any run of whitespace and in any case, never swallowed into the name', () => {
  assert.deepEqual(parse(`[quote=${ACT} USER=${USER}]hi[/quote]`), [{ type: 'quote', act: ACT, children: [text('hi')] }]);
  assert.deepEqual(parse(`[quote=Geno User=${USER}]hi[/quote]`), [fake('Geno', USER, text('hi'))]);
  assert.deepEqual(parse(`[quote=Geno\tuser=${USER}]hi[/quote]`), [fake('Geno', USER, text('hi'))]);
  assert.deepEqual(parse(`[quote=Geno  user=${USER}]hi[/quote]`), [fake('Geno', USER, text('hi'))]);
});

test('a name that is an Act id is a real quote, and user= is dropped', () => {
  assert.deepEqual(parse(`[quote=${ACT} user=${USER}]hi[/quote]`), [{ type: 'quote', act: ACT, children: [text('hi')] }]);
  assert.deepEqual(parse(`[quote="${ACT.toUpperCase()}" user=${USER}]hi[/quote]`), [{ type: 'quote', act: ACT, children: [text('hi')] }]);
});

test('a name over 80 characters, a malformed user= or an empty name makes the opener and its closer text', () => {
  assert.deepEqual(parse(`[quote=${'n'.repeat(80)}]x[/quote]`), [fake('n'.repeat(80), null, text('x'))]);
  assertLiteral([
    `[quote=${'n'.repeat(81)}]x[/quote]`,
    `[quote="${'n'.repeat(81)}"]x[/quote]`,
    '[quote=Geno user=notauuid]x[/quote]',
    '[quote user=notauuid]x[/quote]',
    `[quote=${ACT} user=notauuid]x[/quote]`,
    `[quote user=${USER}x]x[/quote]`,
    '[quote=]x[/quote]',
    '[quote="Geno"x]x[/quote]',
  ]);
});

test('a counterfeit inside a counterfeit, and inside a real quote', () => {
  assert.deepEqual(parse('[quote=A]x[quote=B]y[/quote]z[/quote]'), [fake('A', null, text('x'), fake('B', null, text('y')), text('z'))]);
  assert.deepEqual(parse(`[quote=${ACT}][quote]y[/quote][/quote]`), [{ type: 'quote', act: ACT, children: [fake(null, null, text('y'))] }]);
});

test('counterfeits are capped by MAX_DEPTH like every tag', () => {
  const tree = parse('[quote=A]'.repeat(MAX_DEPTH + 5) + 'core' + '[/quote]'.repeat(MAX_DEPTH + 5));
  assert.ok(depthOf(tree) <= MAX_DEPTH);
  assert.ok(allText(tree).includes('core'));
  assert.equal(allText(tree).split('[quote=A]').length - 1, 5);
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
  assert.deepEqual(unlinked('[url]https://example.com'), [text('[url]https://example.com')]);
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
  assert.deepEqual(unlinked('[img=x]https://a.b/c.png[/img]'), [text('[img=x]https://a.b/c.png[/img]')]);
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
  assert.deepEqual(parse(`[quote=${ACT}zz]x[/quote]`), [fake(`${ACT}zz`, null, text('x'))]);
  assert.deepEqual(parse(`[quote=zz${ACT}]x[/quote]`), [fake(`zz${ACT}`, null, text('x'))]);
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

const spoiler = (title: string, ...children: BbNode[]): BbNode => ({ type: 'spoiler', title, children });
const ispoiler = (...children: BbNode[]): BbNode => ({ type: 'ispoiler', children });

test('[spoiler] is a block with a title, "Spoiler" when none or an empty one is given', () => {
  assert.deepEqual(parse('[spoiler]x[/spoiler]'), [spoiler('Spoiler', text('x'))]);
  assert.deepEqual(parse('[spoiler=]x[/spoiler]'), [spoiler('Spoiler', text('x'))]);
  assert.deepEqual(parse('[spoiler=  ]x[/spoiler]'), [spoiler('Spoiler', text('x'))]);
  assert.deepEqual(parse('[spoiler=The end]x[/spoiler]'), [spoiler('The end', text('x'))]);
  assert.deepEqual(parse('[spoiler="Quoted title"]x[/spoiler]'), [spoiler('Quoted title', text('x'))]);
});

test('a spoiler title is at most 80 characters; a longer one makes the opener text', () => {
  assert.deepEqual(parse(`[spoiler=${'a'.repeat(80)}]x[/spoiler]`), [spoiler('a'.repeat(80), text('x'))]);
  assertLiteral([`[spoiler=${'a'.repeat(81)}]x[/spoiler]`]);
});

test('a spoiler holds anything, other spoilers included', () => {
  assert.deepEqual(parse('[spoiler=a][spoiler=b][b]x[/b][/spoiler][/spoiler]'), [
    spoiler('a', spoiler('b', { type: 'bold', children: [text('x')] })),
  ]);
  assert.equal(parse(`[spoiler][quote=${ACT}]q[/quote][list][*]i[/list][/spoiler]`)[0]?.type, 'spoiler');
});

test('[ispoiler] is inline and takes inline formatting', () => {
  assert.deepEqual(parse('a[ispoiler]b[/ispoiler]c'), [text('a'), ispoiler(text('b')), text('c')]);
  assert.deepEqual(parse('[ispoiler][b]x[/b][/ispoiler]'), [ispoiler({ type: 'bold', children: [text('x')] })]);
  assert.deepEqual(parse('[ispoiler]x'), [ispoiler(text('x'))]);
  assertLiteral(['[ispoiler=x]a[/ispoiler]', '[/ispoiler]', '[/spoiler]']);
});

test('a block tag opened inside [ispoiler] is text, and so is its closer', () => {
  assert.deepEqual(parse('[ispoiler]a[quote]b[/quote]c[/ispoiler]'), [ispoiler(text('a[quote]b[/quote]c'))]);
  assert.deepEqual(parse(`[ispoiler][quote=${ACT}]b[/quote][/ispoiler]`), [ispoiler(text(`[quote=${ACT}]b[/quote]`))]);
  assert.deepEqual(parse('[ispoiler][quote=Geno]b[/quote][/ispoiler]'), [ispoiler(text('[quote=Geno]b[/quote]'))]);
  assert.deepEqual(parse('[ispoiler][list][*]one[/list][/ispoiler]'), [ispoiler(text('[list][*]one[/list]'))]);
  assert.deepEqual(parse('[ispoiler][spoiler]s[/spoiler][/ispoiler]'), [ispoiler(text('[spoiler]s[/spoiler]'))]);
  assert.deepEqual(parse('[ispoiler][code]c[/code][/ispoiler]'), [ispoiler(text('[code]c[/code]'))]);
});

test('a block closer inside [ispoiler] does not close a block opened outside it', () => {
  assert.deepEqual(parse('[spoiler=t]a[ispoiler]b[/spoiler]c[/ispoiler]d[/spoiler]'), [
    spoiler('t', text('a'), ispoiler(text('b[/spoiler]c')), text('d')),
  ]);
});

test('a block tag is a tag again once the [ispoiler] is closed', () => {
  assert.deepEqual(parse('[ispoiler]a[/ispoiler][spoiler]b[/spoiler]'), [ispoiler(text('a')), spoiler('Spoiler', text('b'))]);
});

test('[ispoiler] works inside [spoiler]', () => {
  assert.deepEqual(parse('[spoiler]a[ispoiler]b[/ispoiler][/spoiler]'), [spoiler('Spoiler', text('a'), ispoiler(text('b')))]);
});

// ---- video ----

const YT = 'dQw4w9WgXcQ';
const ytVideo = {
  provider: 'youtube', id: YT, src: `https://www.youtube-nocookie.com/embed/${YT}`, url: `https://youtu.be/${YT}`,
};

test('[video] with a recognized URL is a video; [youtube] takes a URL or a bare id', () => {
  assert.deepEqual(parse(`[video]https://youtu.be/${YT}[/video]`), [{ type: 'video', video: ytVideo }]);
  assert.deepEqual(parse(`[VIDEO] https://youtu.be/${YT} [/VIDEO]`), [{ type: 'video', video: ytVideo }]);
  assert.deepEqual(parse(`[youtube]https://youtu.be/${YT}[/youtube]`), [{ type: 'video', video: ytVideo }]);
  assert.deepEqual(parse(`[youtube]${YT}[/youtube]`), [{ type: 'video', video: ytVideo }]);
  assert.deepEqual(parse(`a[video]https://vimeo.com/12[/video]b`).map((n) => n.type), ['text', 'video', 'text']);
});

test('a bare id is for [youtube] only; a URL no provider matches leaves only the opener as text', () => {
  assert.deepEqual(parse(`[video]${YT}[/video]`), [text(`[video]${YT}[/video]`)]);
  assert.deepEqual(parse(`[youtube]short[/youtube]`), [text('[youtube]short[/youtube]')]);
  assertLiteral([
    '[video]https://example.com/page[/video]', '[video]javascript:alert(1)[/video]', '[video]http://a.example/x.mp4[/video]',
    '[video]https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ[/video]', '[video][/video]', '[video=x]https://youtu.be/dQw4w9WgXcQ[/video]',
  ]);
  assert.deepEqual(parse('[video]nope [b]b[/b][/video]'), [text('[video]nope '), { type: 'bold', children: [text('b')] }, text('[/video]')]);
});

test('[video] with no closer is text, and the rest still parses', () => {
  assert.deepEqual(unlinked(`[video]https://youtu.be/${YT} [b]x[/b]`), [text(`[video]https://youtu.be/${YT} `), { type: 'bold', children: [text('x')] }]);
  assert.deepEqual(parse('[video]'), [text('[video]')]);
});

test('a video is a block: inside an inline spoiler it is text', () => {
  assert.deepEqual(parse(`[ispoiler][video]https://youtu.be/${YT}[/video][/ispoiler]`), [
    { type: 'ispoiler', children: [text(`[video]https://youtu.be/${YT}[/video]`)] },
  ]);
});

test('video and youtube are listed tags', () => {
  assert.ok(BBCODE_TAGS.includes('video') && BBCODE_TAGS.includes('youtube'));
});

test('many unclosed [video] openers cost one search, not one each', () => {
  const t0 = Date.now();
  parse('[video]https://youtu.be/dQw4w9WgXcQ'.repeat(35_000));
  parse('[video]' + 'x'.repeat(5000) + '[youtube]'.repeat(10_000) + '[/video]');
  assert.ok(Date.now() - t0 < 2000);
});

test('a link or another [ispoiler] opened inside [ispoiler] is text, since the spoiler is a button', () => {
  assert.deepEqual(parse('[ispoiler][url=https://x.y]a[/url][/ispoiler]'), [ispoiler(text('[url=https://x.y]a[/url]'))]);
  assert.deepEqual(parse('[ispoiler][url]https://x.y[/url][/ispoiler]'), [ispoiler(text('[url]https://x.y[/url]'))]);
  assert.deepEqual(parse('[ispoiler][ispoiler]a[/ispoiler]b[/ispoiler]'), [ispoiler(text('[ispoiler]a')), text('b[/ispoiler]')]);
  assert.deepEqual(parse('[url=https://x.y]a[ispoiler]b[/ispoiler]c[/url]'), [
    { type: 'url', href: 'https://x.y', children: [text('a'), ispoiler(text('b')), text('c')] },
  ]);
  assert.deepEqual(parse('[ispoiler]a[/ispoiler][url=https://x.y]b[/url]'), [ispoiler(text('a')), { type: 'url', href: 'https://x.y', children: [text('b')] }]);
});

test('an empty [ispoiler] is an empty spoiler node', () => {
  assert.deepEqual(parse('[ispoiler][/ispoiler]'), [ispoiler()]);
});

test('center, left and right align a block; they take no attribute, and [align=...] is not a tag', () => {
  for (const a of ['center', 'left', 'right'] as const) {
    assert.deepEqual(parse(`[${a}]x[/${a}]`), [{ type: 'align', align: a, children: [text('x')] }]);
  }
  assert.deepEqual(parse('[CENTER]x[/Center]'), [{ type: 'align', align: 'center', children: [text('x')] }]);
  assertLiteral(['[center=x]x[/center]', '[align=center]x[/align]', '[align]x[/align]', '[align=left]x[/align]']);
});

test('hr stands alone, and its closer is text', () => {
  assert.deepEqual(parse('[hr]'), [{ type: 'hr' }]);
  assert.deepEqual(parse('a[hr]b'), [text('a'), { type: 'hr' }, text('b')]);
  assert.deepEqual(parse('[hr][/hr]'), [{ type: 'hr' }, text('[/hr]')]);
  assertLiteral(['[hr=1]', '[/hr]']);
});

test('sub, sup, marquee and rainbow are containers without an attribute', () => {
  for (const t of ['sub', 'sup', 'marquee', 'rainbow'] as const) {
    assert.deepEqual(parse(`[${t}]x[/${t}]`), [{ type: t, children: [text('x')] }]);
    assertLiteral([`[${t}=1]x[/${t}]`]);
  }
});

test('font takes a name from the list, without regard to case; any other font is text', () => {
  assert.deepEqual(parse('[font=Verdana]x[/font]'), [{ type: 'font', font: 'verdana', children: [text('x')] }]);
  assert.deepEqual(parse('[font=times new roman]x[/font]'), [{ type: 'font', font: 'times new roman', children: [text('x')] }]);
  assert.deepEqual(parse('[font="Comic Sans MS"]x[/font]'), [{ type: 'font', font: 'comic sans ms', children: [text('x')] }]);
  for (const f of ['Verdana', 'Arial', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Impact']) {
    assert.equal(parse(`[font=${f}]x[/font]`)[0]?.type, 'font', f);
  }
  assertLiteral(['[font=Papyrus]x[/font]', '[font]x[/font]', '[font=Arial, evil]x[/font]', '[font=Arial;x]x[/font]']);
});

test('glow and shadow take an optional safe color', () => {
  assert.deepEqual(parse('[glow]x[/glow]'), [{ type: 'glow', color: null, children: [text('x')] }]);
  assert.deepEqual(parse('[glow=Red]x[/glow]'), [{ type: 'glow', color: 'red', children: [text('x')] }]);
  assert.deepEqual(parse('[shadow=#0af]x[/shadow]'), [{ type: 'shadow', color: '#0af', children: [text('x')] }]);
  assert.deepEqual(parse('[shadow]x[/shadow]'), [{ type: 'shadow', color: null, children: [text('x')] }]);
  assertLiteral(['[glow=url(x)]x[/glow]', '[shadow=notacolor]x[/shadow]']);
});

test('highlight takes an optional safe color, yellow by default', () => {
  assert.deepEqual(parse('[highlight]x[/highlight]'), [{ type: 'highlight', color: 'yellow', children: [text('x')] }]);
  assert.deepEqual(parse('[highlight=navy]x[/highlight]'), [{ type: 'highlight', color: 'navy', children: [text('x')] }]);
  assertLiteral(['[highlight=expression(x)]x[/highlight]']);
});

const noparse = (t: string): BbNode => ({ type: 'noparse', text: t });
test('noparse is its contents, as one noparse node', () => {
  assert.deepEqual(parse('[noparse][b]x[/b][/noparse]'), [noparse('[b]x[/b]')]);
  assert.deepEqual(parse('a[NOPARSE][i]x[/NoParse]b'), [text('a'), noparse('[i]x'), text('b')]);
  assert.deepEqual(parse('a[noparse][url=javascript:x]y[/url][/noparse]b'), [text('a'), noparse('[url=javascript:x]y[/url]'), text('b')]);
  assert.deepEqual(parse('[noparse][/noparse]'), []);
  // No closer, or an attribute: only the opener is text, and the rest parses as usual.
  assert.deepEqual(parse('[noparse][b]x[/b]'), [text('[noparse]'), { type: 'bold', children: [text('x')] }]);
  assert.deepEqual(parse('[noparse=1][b]x[/b][/noparse]'), [text('[noparse=1]'), { type: 'bold', children: [text('x')] }, text('[/noparse]')]);
});

test('a layout tag is text, with its closer, inside an inline spoiler; the inline effects are not', () => {
  const t = parse('[ispoiler][center]x[/center][left]z[/left][right]w[/right][marquee]y[/marquee][hr][/ispoiler]');
  assert.deepEqual(t, [{ type: 'ispoiler', children: [text('[center]x[/center][left]z[/left][right]w[/right][marquee]y[/marquee][hr]')] }]);
  assert.deepEqual(parse('[ispoiler][glow]x[/glow][/ispoiler]')[0], { type: 'ispoiler', children: [{ type: 'glow', color: null, children: [text('x')] }] });
});

test('the new tags are named for a rule that names one', () => {
  for (const t of ['center', 'left', 'right', 'hr', 'sub', 'sup', 'font', 'marquee', 'glow', 'shadow', 'rainbow', 'highlight', 'noparse']) assert.ok(BBCODE_TAGS.includes(t), t);
});

/* Auto-linking (design 4): a bare address in text becomes an `autolink`; its words stay the post's own. */
const links = (input: string): string[] => {
  const found: string[] = [];
  const visit = (nodes: readonly BbNode[]) => {
    for (const n of nodes) {
      if (n.type === 'autolink') found.push(n.href);
      if ('children' in n) visit(n.children);
      if (n.type === 'list') for (const item of n.items) visit(item);
    }
  };
  visit(parse(input));
  return found;
};

test('an address mid-sentence is split out as an autolink, the words around it kept', () => {
  assert.deepEqual(parse('see https://x.example/a now'), [text('see '), { type: 'autolink', href: 'https://x.example/a', text: 'https://x.example/a' }, text(' now')]);
  assert.deepEqual(parse('https://x.example'), [{ type: 'autolink', href: 'https://x.example', text: 'https://x.example' }]);
});

test('trailing punctuation and an unmatched closer stay outside the address', () => {
  assert.deepEqual(parse('go http://x.example/a.'), [text('go '), { type: 'autolink', href: 'http://x.example/a', text: 'http://x.example/a' }, text('.')]);
  assert.deepEqual(parse('(see https://x.example/a)'), [text('(see '), { type: 'autolink', href: 'https://x.example/a', text: 'https://x.example/a' }, text(')')]);
  assert.deepEqual(links('x https://x.example/a?!;:, y'), ['https://x.example/a']);
  assert.deepEqual(links('[https://x.example/a]'), ['https://x.example/a']);
  // A closer with its opener inside the address belongs to it.
  assert.deepEqual(links('https://x.example/b_(c) and https://x.example/d_(e).'), ['https://x.example/b_(c)', 'https://x.example/d_(e)']);
  assert.deepEqual(links('(https://x.example/b_(c))'), ['https://x.example/b_(c)']);
});

test('a query and a fragment are part of the address', () => {
  assert.deepEqual(links('at https://x.example/p?a=1&b=2#frag, ok'), ['https://x.example/p?a=1&b=2#frag']);
});

test('inside [url], [img], [code], [noparse], [video] and [ispoiler] an address is not split', () => {
  for (const input of [
    '[url=https://a.example]see https://x.example/a[/url]',
    '[url]https://x.example/a[/url]',
    '[code]https://x.example/a[/code]',
    '[noparse]https://x.example/a[/noparse]',
    '[ispoiler]https://x.example/a[/ispoiler]',
    '[ispoiler][b]https://x.example/a[/b][/ispoiler]',
  ]) assert.deepEqual(links(input), [], input);
  assert.deepEqual(links('[img]https://x.example/a.png[/img][video]https://youtu.be/dQw4w9WgXcQ[/video]'), []);
  // The rest of the post still links, and so does a spoiler's block form.
  assert.deepEqual(links('[ispoiler]https://a.example[/ispoiler] https://b.example'), ['https://b.example']);
  assert.deepEqual(links('[spoiler]https://a.example[/spoiler]'), ['https://a.example']);
});

test('an address inside bold links inside the bold, before its period', () => {
  const tree = parse('[b]see https://x.example/a.[/b]');
  assert.deepEqual(tree, [{ type: 'bold', children: [text('see '), { type: 'autolink', href: 'https://x.example/a', text: 'https://x.example/a' }, text('.')] }]);
  assert.deepEqual(links('[list][*]https://l.example/1,[*]two[/list]'), ['https://l.example/1']);
});

test('javascript:, data: and refused addresses are not linked', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,x', 'http://', 'https://user@evil.example/', 'https://a..b/', 'ftp://x.example/a']) {
    assert.deepEqual(links(input), [], input);
  }
  assert.deepEqual(parse('javascript:alert(1)'), [text('javascript:alert(1)')]);
  // The address ends at a character safeHref refuses.
  assert.deepEqual(links('https://x.example/a"b'), ['https://x.example/a']);
  assert.deepEqual(links('http://exa"mple.com'), []);
});

test('a long run of schemes, and of valid addresses, stays linear', () => {
  const t0 = Date.now();
  parse('http://'.repeat(60_000));
  parse('http://http://'.repeat(30_000) + 'x');
  parse('https://a.example/'.repeat(1) + 'a'.repeat(300_000));
  parse('http://a.example/p '.repeat(20_000));
  parse('(' .repeat(100_000) + 'https://x.example/' + ')'.repeat(100_000));
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
});

test('the visible text of a post with an address is what it was before auto-linking', () => {
  const recorded: [string, string][] = [
  ["see https://x.example/a. and more", "see https://x.example/a. and more"],
  ["(go to http://a.example/b_(c)) now", "(go to http://a.example/b_(c)) now"],
  ["ca[b]ts https://x.example/q?a=1&b=2#frag[/b] dogs", "cats https://x.example/q?a=1&b=2#frag dogs"],
  ["a [url=https://l.example]https://in.example[/url] b https://out.example/z", "a \n b https://out.example/z"],
  ["x[quote=0f8fad5b-d9cb-469f-a165-70867728950e]https://q.example[/quote]y https://z.example", "x\ny https://z.example"],
  ["[ispoiler]https://s.example/a[/ispoiler] tail http://t.example", "https://s.example/a tail http://t.example"],
  ["[list][*]https://l.example/1,[*]two http://l.example/2[/list]", "\nhttps://l.example/1,\ntwo http://l.example/2\n"],
  ["javascript:alert(1) data:text/html,x https://ok.example/p;", "javascript:alert(1) data:text/html,x https://ok.example/p;"],
  ["[noparse]https://n.example[/noparse] https://m.example", "https://n.example https://m.example"],
  ["[code]https://c.example[/code] https://d.example", "\n https://d.example"],
  ["ca[b]ts[/b] and [i][color=red]dogs[/color][/i]", "cats and dogs"],
  ["before https://a.example/x!? after", "before https://a.example/x!? after"],
  ];
  for (const [input, expected] of recorded) assert.equal(visibleText(parse(input)), expected, input);
});

test('a literal tag closer after an address stays text after the link', () => {
  assert.deepEqual(parse('[img=x]https://a.b/c.png[/img]'), [text('[img=x]'), { type: 'autolink', href: 'https://a.b/c.png', text: 'https://a.b/c.png' }, text('[/img]')]);
  assert.deepEqual(links('https://a.b/x[/b]'), ['https://a.b/x']);
  assert.deepEqual(links('https://a.b/x[b]y'), ['https://a.b/x']);
  assert.deepEqual(links('https://a.b/x[color=red'), ['https://a.b/x']);
  assert.deepEqual(links('https://a.b/x[*]'), ['https://a.b/x']);
  assert.deepEqual(links('https://a.b/w[1]'), ['https://a.b/w[1]']);
  assert.deepEqual(links('https://a.b/w[a-b]'), ['https://a.b/w[a-b]']);
});

test('a refused character inside the host leaves the whole run unlinked, one in the path only cuts', () => {
  assert.deepEqual(links('http://exa"mple.com'), []);
  assert.deepEqual(links('http://exa<mple.com/p'), []);
  assert.deepEqual(links('http://a.example/p"q'), ['http://a.example/p']);
  assert.deepEqual(links('http://a.example "q'), ['http://a.example']);
});

test('an auto-linked address at the maximum length links and one past it stays text', () => {
  const base = 'https://a.example/';
  const ok = base + 'a'.repeat(MAX_URL_LENGTH - base.length);
  assert.equal(ok.length, MAX_URL_LENGTH);
  assert.deepEqual(links(ok), [ok]);
  assert.deepEqual(links(ok + 'a'), []);
});

test('tag-shaped scans stay linear', () => {
  for (const unit of ['https://a.b/[x', 'https://a.b/[/b]']) {
    const started = performance.now();
    parse(unit.repeat(100000));
    const ms = performance.now() - started;
    assert.ok(ms < 3000, `${unit} took ${ms}ms`);
  }
});

/*
 * A real quote past the cap is cut, never text ("A quote past the cap is cut, never text", docs/plans/2026-11-13-quote-cut-plan.md, Decisions 1 to 4). Every depth is written from MAX_DEPTH.
 */
const ids = (n: number, from = 0): string[] => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(from + i).padStart(12, '0')}`);
const cutOf = (...acts: string[]): BbNode => ({ type: 'cut', acts });
/** `n` real quotes nested, each of its own id, around `core`, all closed. */
const pyramidOf = (n: number, core = 'core'): string => ids(n).map((id) => `[quote=${id}]`).join('') + core + '[/quote]'.repeat(n);
/** The tree's real quotes down the single path from the root, and what stands where the next one would. */
function spine(nodes: readonly BbNode[]): { quotes: number; end: BbNode[] } {
  let quotes = 0;
  let cur: readonly BbNode[] = nodes;
  for (;;) {
    const q = cur.find((n) => n.type === 'quote');
    if (!q || q.type !== 'quote') return { quotes, end: [...cur] };
    quotes++;
    cur = q.children;
  }
}

test('a pyramid of MAX_DEPTH + 5 real quotes is MAX_DEPTH quotes and one cut holding the other five Acts, outermost first', () => {
  const all = ids(MAX_DEPTH + 5);
  const spans: QuoteSpan[] = [];
  const tree = parse(pyramidOf(MAX_DEPTH + 5), spans);
  const { quotes, end } = spine(tree);
  assert.equal(quotes, MAX_DEPTH);
  assert.deepEqual(end, [cutOf(...all.slice(MAX_DEPTH))]);
  assert.ok(depthOf(tree) <= MAX_DEPTH + 1);
  assert.equal(spans.length, MAX_DEPTH + 5, 'every quote is reported, past the cap too');
  assert.deepEqual(new Set(spans.map((s) => s.act)), new Set(all));
  // in the order they close: the innermost first
  assert.deepEqual(spans.map((s) => s.act), [...all].reverse());
});

test('nothing inside a cut is kept, and what follows it is', () => {
  const [a, b] = ids(2, 9000) as [string, string];
  const deep = ids(MAX_DEPTH).map((id) => `[quote=${id}]`).join('');
  const tree = parse(`${deep}x[quote=${a}]secret [b]bold[/b] [url=https://e.com/]l[/url] [quote=Bob]fake[/quote][quote=${b}]more[/quote][/quote]y${'[/quote]'.repeat(MAX_DEPTH)}z`);
  const { quotes, end } = spine(tree);
  assert.equal(quotes, MAX_DEPTH);
  assert.deepEqual(end, [text('x'), cutOf(a, b), text('y')]);
  assert.equal(allText(tree).includes('secret'), false);
  assert.equal(JSON.stringify(tree).includes('fake'), false);
  assert.deepEqual(tree.at(-1), text('z'));
});

test('a cut is closed by its closer, by an outer closer, or by the end of the input, as a quote is', () => {
  const deep = ids(MAX_DEPTH).map((id) => `[quote=${id}]`).join('');
  const [a, b] = ids(2, 9000) as [string, string];
  const spans: QuoteSpan[] = [];
  parse(`${deep}[quote=${a}]x`, spans);
  const unclosed = spans.find((s) => s.act === a)!;
  assert.equal(unclosed.to, `${deep}[quote=${a}]x`.length, 'closed by the end of input');
  const outer: QuoteSpan[] = [];
  const body = `${deep}[quote=${a}]x[quote=${b}]y[/quote]z${'[/quote]'.repeat(MAX_DEPTH + 1)}`;
  const tree = parse(body, outer);
  assert.deepEqual(outer.slice(0, 2).map((s) => s.act), [b, a]);
  assert.equal(body.slice(outer[0]!.from, outer[0]!.to), 'y');
  assert.equal(body.slice(outer[1]!.from, outer[1]!.to), `x[quote=${b}]y[/quote]z`);
  assert.equal(spine(tree).quotes, MAX_DEPTH);
  // an outer closer closes the cuts inside it too, and the rest of the post is the post's
  const closed = parse(`${deep}[quote=${a}]x[quote=${b}]y${'[/quote]'.repeat(MAX_DEPTH + 2)}tail`);
  assert.deepEqual(closed, parse(`${deep}[quote=${a}]x[quote=${b}]y[/quote][/quote]${'[/quote]'.repeat(MAX_DEPTH)}tail`));
  assert.deepEqual(closed.at(-1), text('tail'));
});

test('counterfeits past the cap are text, and a real quote inside them is cut', () => {
  const [a] = ids(1, 9000) as [string];
  const fakes = '[quote=A]'.repeat(MAX_DEPTH + 3);
  const tree = parse(`${'[quote=A]'.repeat(MAX_DEPTH)}${fakes}core[quote=${a}]secret[/quote]${'[/quote]'.repeat(MAX_DEPTH + 3)}`);
  assert.ok(depthOf(tree) <= MAX_DEPTH + 1);
  const t = allText(tree);
  assert.ok(t.includes('core'));
  assert.equal(t.includes('secret'), false);
  assert.equal(t.split('[quote=A]').length - 1, MAX_DEPTH + 3);
  assert.ok(JSON.stringify(tree).includes(`"type":"cut","acts":["${a}"]`));
});

test('other tags past the cap are text beside a cut, and code, noparse and a bad opener behave in a cut as outside it', () => {
  const [a, b] = ids(2, 9000) as [string, string];
  const deep = ids(MAX_DEPTH).map((id) => `[quote=${id}]`).join('') + `[quote=${a}]`;
  const spans: QuoteSpan[] = [];
  parse(`${deep}[code][quote=${b}]x[/quote][/code][noparse][quote=${b}][/noparse][quote=Bob][quote=${b}]y[/quote][/quote][quote=${b} user=nope]z`, spans);
  // the quote inside [code] and [noparse] is no quote, a counterfeit is none and so is a bad opener; the one inside the counterfeit is
  assert.equal(spans.filter((s) => s.act === b).length, 1);
  const inCode = parse(`${deep}[code]x[/code]${'[/quote]'.repeat(MAX_DEPTH + 1)}`);
  assert.deepEqual(spine(inCode).end, [cutOf(a)]);
});

test('10,000 nested real quotes parse in time that grows with their length alone, and the tree is no deeper than a pyramid of the cap', () => {
  const time = (n: number) => {
    const body = pyramidOf(n);
    const spans: QuoteSpan[] = [];
    const t = performance.now();
    const tree = parse(body, spans);
    const ms = performance.now() - t;
    assert.ok(depthOf(tree) <= MAX_DEPTH + 1, `depth ${depthOf(tree)}`);
    assert.equal(spans.length, n);
    assert.equal(allText(tree).includes('core'), false);
    return ms;
  };
  time(1000);
  const small = Math.min(time(2500), time(2500), time(2500));
  const big = Math.min(time(10_000), time(10_000), time(10_000));
  assert.ok(big < Math.max(small * 12, 200), `${small} ms at 2,500, ${big} ms at 10,000`);
  assert.ok(big < 2000, `took ${big}ms`);
  const unclosed = ids(1, 9000)[0]!;
  const t = performance.now();
  const tree = parse(`[quote=${unclosed}]`.repeat(10_000) + 'x');
  assert.ok(performance.now() - t < 2000);
  assert.equal(spine(tree).quotes, MAX_DEPTH);
});

test('quotes nested past the cap inside formatting tags count against the one cap', () => {
  const [a] = ids(1, 9000) as [string];
  const tree = parse('[b]'.repeat(MAX_DEPTH) + `[quote=${a}]secret[/quote]` + '[/b]'.repeat(MAX_DEPTH));
  assert.equal(allText(tree).includes('secret'), false);
  assert.ok(JSON.stringify(tree).includes(`"type":"cut","acts":["${a}"]`));
});

test('the megabyte shapes hold with real quotes', () => {
  const a = ids(1, 9000)[0]!;
  const shapes: Record<string, string> = {
    openers: `[quote=${a}]`.repeat(30_000),
    pyramid: `[quote=${a}]x`.repeat(30_000) + '[/quote]'.repeat(30_000),
    closers: `[quote=${a}]`.repeat(MAX_DEPTH + 1) + '[/quote]'.repeat(250_000),
    hostile: `[quote=${a}]` + '[quote=zz][b]'.repeat(40_000),
  };
  for (const [name, input] of Object.entries(shapes)) {
    const started = performance.now();
    const tree = parse(input, []);
    const ms = performance.now() - started;
    assert.ok(ms < 3000, `${name} took ${ms}ms`);
    assert.ok(depthOf(tree) <= MAX_DEPTH + 1, `${name} too deep`);
  }
});
