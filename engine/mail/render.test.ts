import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blend, renderHtml, renderText } from './render.ts';
import type { Mail, MailTheme } from './types.ts';

const theme: MailTheme = {
  name: 'Test Instance',
  site: 'https://example.test',
  assets: {
    smoke: 'https://example.test/mail/smoke.jpg',
    cutPanel: 'https://example.test/mail/cut-panel.png',
    cutButton: 'https://example.test/mail/cut-button.png',
    coin: 'https://example.test/mail/coin.png',
  },
  fonts: [
    { family: 'Disp', url: 'https://example.test/mail/disp.woff2', weight: 400, style: 'normal' },
    { family: 'Bod', url: 'https://example.test/mail/bod.woff2', weight: 500, style: 'normal' },
  ],
  stacks: { display: "Disp, Impact, 'Arial Narrow Bold', sans-serif", body: "Bod, 'Arial Narrow', Arial, sans-serif" },
  colors: {
    ground: '#07050d', field: '#160d2a', text: '#f1ecff', text2: '#e4def7', hi: '#ffffff',
    pale: '#c9f8ff', neon: '#19e3ff', neonText: '#9ef4ff', violet: '#a78bfa', ink: '#03141a',
  },
};
const C = theme.colors;
// The alphas the shell blends at: the seam's three rows, the rules (35%) and the quote's edge (55%).
const ALLOWED = new Set<string>([
  ...Object.values(C),
  ...[0.38, 0.18, 0.07].map((a) => blend(C.neon, C.ground, a)),
  ...[0.35, 0.55].map((a) => blend(C.violet, C.ground, a)),
  // The Gmail-only blend identity: `screen` and `difference` do nothing over black. It sits in the
  // `u + .body` rules, which only Gmail matches, and is never painted as a color.
  '#000',
].map((h) => h.toLowerCase()));

const mail: Mail = {
  subject: 'Subject <&>',
  preheader: 'Pre "header" 482915',
  blocks: [
    { type: 'heading', text: '<b>&' },
    { type: 'paragraph', text: 'Paragraph words it\'s "quoted"' },
    { type: 'code', label: 'Your code', code: '482915' },
    { type: 'button', label: 'Sign in', href: '{{ .ConfirmationURL }}' },
    { type: 'facts', rows: [['Thread', 'Who <keeps> reacting'], ['Rule', 'Rule one']] },
    { type: 'quote', label: 'Your post', words: 'Bold words & more' },
    { type: 'note', text: 'Note sentence.' },
  ],
};
const slots = ['{{ .ConfirmationURL }}', '{{ .Token }}'] as const;
const html = renderHtml(theme, mail, { slots });
const count = (s: string, sub: string) => s.split(sub).length - 1;

test('each block renders, escaped, its words once', () => {
  assert.equal(count(html, '&lt;b&gt;&amp;'), 1);
  assert.ok(!html.includes('<b>'));
  for (const w of ['Paragraph words it&#39;s &quot;quoted&quot;', '482915', 'Your code', 'Sign in', 'Thread',
    'Who &lt;keeps&gt; reacting', 'Rule one', 'Your post', 'Bold words &amp; more', 'Note sentence.']) {
    // the preheader also holds 482915, so it is counted twice by design
    assert.equal(count(html, w), w === '482915' ? 2 : 1, w);
  }
  assert.ok(html.includes('<title>Subject &lt;&amp;&gt;</title>'));
});

test('a slot survives as a code value and the shell writes no {{ of its own', () => {
  const withSlot = renderHtml(theme, { ...mail, blocks: [{ type: 'code', label: 'L', code: '{{ .Token }}' }] }, { slots });
  assert.equal(count(withSlot, '{{ .Token }}'), 1);
  assert.equal(count(withSlot, '{{'), 1);
  assert.equal(count(renderHtml(theme, { ...mail, blocks: [] }), '{{'), 0);
});

test('no border-radius, box-shadow or transform', () => {
  assert.doesNotMatch(html, /border-radius|box-shadow|(?<![-\w])transform\s*:/i);
});

test('every img has width, height and alt; the coin is the last', () => {
  const imgs = html.match(/<img\b[^>]*>/g) ?? [];
  assert.ok(imgs.length >= 3);
  for (const i of imgs) {
    assert.match(i, /\swidth="\d+"/);
    assert.match(i, /\sheight="\d+"/);
    assert.match(i, /\salt="[^"]*"/);
  }
  assert.ok(imgs[imgs.length - 1]?.includes(theme.assets.coin));
  assert.match(imgs[imgs.length - 1] ?? '', /width="40" height="40" alt=""/);
  assert.equal(count(html, theme.assets.coin), 1);
});

test('hrefs are https, mailto or a declared slot; others throw naming the block', () => {
  for (const m of html.matchAll(/\shref="([^"]*)"/g)) {
    const h = m[1] ?? '';
    assert.ok(/^(https:|mailto:)/.test(h) || (slots as readonly string[]).includes(h), h);
  }
  const bad = (href: string, s?: readonly string[]) => () =>
    renderHtml(theme, { ...mail, blocks: [{ type: 'paragraph', text: 'x' }, { type: 'paragraph', text: 'y' }, { type: 'button', label: 'b', href }] }, s ? { slots: s } : undefined);
  assert.throws(bad('javascript:alert(1)'), /button block 3: href/);
  assert.throws(bad('{{ .ConfirmationURL }}'), /button block 3/); // undeclared slot
  assert.throws(bad('http://example.test'), /button block 3/);
  assert.throws(bad('{{ .ConfirmationURL }} x', slots), /button block 3/); // not exactly a slot
  bad('mailto:a@b.test')();
  bad('https://x.test/?a=1&b="2"')();
});

test('every hex in the output is a theme color or a blend of two', () => {
  const hexes = [...html.matchAll(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
  assert.ok(hexes.length > 10);
  for (const h of hexes) assert.ok(ALLOWED.has(h), `stray color ${h}`);
  // every seam blend really is present
  for (const a of [0.38, 0.18, 0.07]) assert.ok(html.includes(blend(C.neon, C.ground, a)));
  // no named colors in a color/background property
  assert.doesNotMatch(html, /(?:color|background|border[\w-]*)\s*:[^;"}]*\b(?:white|black|red|blue|green|gray|grey|silver|yellow|orange|purple|pink|cyan)\b/i);
});

test('blend', () => {
  assert.equal(blend('#ffffff', '#000000', 0.5), '#808080');
  assert.equal(blend('#19e3ff', '#07050d', 1), '#19e3ff');
  assert.equal(blend('#19e3ff', '#07050d', 0), '#07050d');
});

test('renderText holds every block\'s words and no markup', () => {
  const t = renderText(mail);
  for (const w of ['<B>&', 'Paragraph words', '482915', 'Your code', 'Sign in: {{ .ConfirmationURL }}', 'Thread: Who <keeps> reacting', 'Rule: Rule one', '> Your post', '> Bold words & more', 'Note sentence.']) {
    assert.ok(t.includes(w), w);
  }
  assert.doesNotMatch(renderText({ ...mail, blocks: [{ type: 'paragraph', text: 'plain' }, { type: 'code', label: 'L', code: '1' }] }), /</);
});

test('VML masthead, mso block, dark color-scheme, Gmail blend, one head style', () => {
  assert.match(html, /xmlns:v="urn:schemas-microsoft-com:vml"/);
  assert.match(html, /<v:rect[\s\S]*<v:fill[^>]*src="https:\/\/example\.test\/mail\/smoke\.jpg"/);
  assert.ok(html.includes('<!--[if mso]>'));
  assert.match(html, /Impact/);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<meta name="supported-color-schemes" content="dark">/);
  assert.ok(html.includes(':root{color-scheme:dark}'));
  assert.match(html, /u \+ \.body [^{]*\{[^}]*mix-blend-mode:screen/);
  assert.match(html, /u \+ \.body [^{]*\{[^}]*mix-blend-mode:difference/);
  assert.match(html, /@media\s*\(max-width:620px\)/);
  assert.equal(count(html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, ''), '<style'), 1);
  assert.match(html, /bgcolor="#07050d"/);
  assert.match(html, /linear-gradient\(#07050d,#07050d\)/);
  // seam: pale row then three blended rows
  assert.ok(html.indexOf(C.pale) < html.indexOf(blend(C.neon, C.ground, 0.38)));
});

test('Gmail blend wrappers: screen outside, difference inside, over black, same classes in the CSS', () => {
  assert.ok(html.includes('<div class="gs"><div class="gd"><p'));
  assert.ok(html.includes('</p></div></div>'));
  assert.match(html, /u \+ \.body \.gs\{background:#000;mix-blend-mode:screen\}/);
  assert.match(html, /u \+ \.body \.gd\{background:#000;mix-blend-mode:difference\}/);
  // every text run carries both wrappers: as many gs openers as gd openers, nested
  assert.equal(count(html, 'class="gs"'), count(html, '<div class="gs"><div class="gd">'));
});

test('every way a theme can be bad throws, naming the field', () => {
  const t = (f: (x: MailTheme) => MailTheme) => () => renderHtml(f(theme), mail, { slots });
  assert.throws(t((x) => ({ ...x, colors: { ...x.colors, neon: 'cyan' } })), /theme color neon: not a 6-digit hex/);
  assert.throws(t((x) => ({ ...x, assets: { ...x.assets, coin: 'http://example.test/c.png' } })), /theme coin: not an absolute https URL/);
  assert.throws(t((x) => ({ ...x, site: 'https://example.test/a)b' })), /theme site: not an absolute https URL/);
  assert.throws(t((x) => ({ ...x, stacks: { ...x.stacks, body: 'Bod, "Arial"' } })), /theme stack body/);
  assert.throws(t((x) => ({ ...x, stacks: { ...x.stacks, display: 'Disp; x:y' } })), /theme stack display/);
  assert.throws(t((x) => ({ ...x, fonts: [{ family: "Bo'd", url: 'https://example.test/a.woff2', weight: 400, style: 'normal' }] })), /theme font Bo'd: bad family/);
  assert.throws(t((x) => ({ ...x, fonts: [{ family: 'Bod', url: 'https://example.test/a)b.woff2', weight: 400, style: 'normal' }] })), /theme font Bod: not an absolute https URL/);
  assert.throws(t((x) => ({ ...x, assets: { ...x.assets, smoke: 'https://example.test/{x}.jpg' } })), /theme smoke: not an absolute https URL/);
});

test('a control character in an href throws even after a good scheme', () => {
  const b = (href: string) => () => renderHtml(theme, { ...mail, blocks: [{ type: 'button', label: 'b', href }] });
  assert.throws(b('https:\n//x.test'), /button block 1: href holds a control character/);
  assert.throws(b('mailto:a\u0000'), /button block 1: href holds a control character/);
});

test('VML masthead geometry: the rect fills the cell once, with one set of padding', () => {
  assert.match(html, /<v:rect [^>]*style="width:600px;height:180px;v-text-anchor:middle"/);
  assert.ok(html.includes('<v:textbox inset="40px,0,40px,0">'));
  assert.ok(html.includes('</v:textbox></v:rect><![endif]-->'));
  const mast = html.match(/<td class="mast"[^>]*>/)?.[0] ?? '';
  assert.match(mast, /padding:0"/);
  // outside Outlook the 40px comes from a div, hidden from Outlook
  assert.ok(html.includes('<!--[if !mso]><!--><div class="pad" style="padding:0 40px"><!--<![endif]-->'));
});

test('a stray {{ or }} in caller text throws, naming the block; a declared slot does not', () => {
  const m = (b: Mail['blocks'][number]) => () => renderHtml(theme, { ...mail, blocks: [b] }, { slots });
  assert.throws(m({ type: 'heading', text: 'Hello {{ name }}' }), /heading block 1: .*\{\{/);
  assert.throws(m({ type: 'note', text: 'oops }}' }), /note block 1: .*\}\}/);
  assert.throws(m({ type: 'quote', label: 'L', words: '{{ .Other }}' }), /quote block 1/);
  assert.throws(() => renderHtml(theme, { ...mail, preheader: '{{ x }}' }, { slots }), /preheader/);
  m({ type: 'code', label: 'L', code: '{{ .Token }}' })();
});

test('theme URLs are attribute-escaped', () => {
  const t = { ...theme, assets: { ...theme.assets, coin: 'https://example.test/c.png?a=1&b=2' } };
  const out = renderHtml(t, mail, { slots });
  assert.ok(out.includes('src="https://example.test/c.png?a=1&amp;b=2"'));
  assert.ok(!out.includes('a=1&b=2'));
});
