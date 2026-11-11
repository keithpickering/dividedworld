import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BbCode, type QuoteOf } from './render.tsx';
import { TextLayer, type TextRun } from './layers.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
import { RouterProvider } from '../router.tsx';

const show = (text: string, quoteHead?: (q: QuoteOf) => React.ReactNode) =>
  render(<RouterProvider><div data-testid="out"><BbCode text={text} quoteHead={quoteHead} /></div></RouterProvider>);
const out = () => screen.getByTestId('out');

describe('the BBCode renderer', () => {
  test('plain text is text, escaped: markup a player typed stays words', () => {
    show('a <script>alert(1)</script> & <b>not bold</b>');
    expect(out().textContent).toBe('a <script>alert(1)</script> & <b>not bold</b>');
    expect(out().querySelector('script')).toBeNull();
  });

  test('bold, italic, underline and strike', () => {
    show('[b]b[/b][i]i[/i][u]u[/u][s]s[/s]');
    expect(out().querySelector('strong')).toHaveTextContent('b');
    expect(out().querySelector('em')).toHaveTextContent('i');
    expect(out().querySelector('u')).toHaveTextContent('u');
    expect(out().querySelector('s')).toHaveTextContent('s');
  });

  test('a color is set as a value on a span', () => {
    show('[color=red]hot[/color][color=#0af]cool[/color]');
    const spans = [...out().querySelectorAll<HTMLElement>('span[style]')];
    expect(spans.map((s) => s.style.color)).toEqual(['red', 'rgb(0, 170, 255)']);
  });

  test('a size is a class from a fixed scale, never a free number', () => {
    show('[size=5]big[/size]');
    const span = out().querySelector('span.kb-bb-size-5');
    expect(span).toHaveTextContent('big');
    expect(span).not.toHaveAttribute('style');
  });

  test('a link carries every rel a user-written link should', () => {
    show('[url=https://example.com/x]there[/url] and [url]https://example.org/[/url]');
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/x', 'https://example.org/']);
    for (const a of links) {
      expect(a).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
      expect(a).toHaveAttribute('referrerpolicy', 'no-referrer');
    }
  });

  test('a javascript: link stays the text it was written as', () => {
    show('[url=javascript:alert(1)]click[/url]');
    expect(screen.queryByRole('link')).toBeNull();
    expect(out().textContent).toBe('[url=javascript:alert(1)]click[/url]');
  });

  test('an image is lazy, sends no referrer and has alt text', () => {
    show('[img]https://img.example.com/a/pic.png[/img]');
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://img.example.com/a/pic.png');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img.getAttribute('alt')).toBeTruthy();
  });

  test('an http: image is a plain link to it, never an <img> (the page loads images over https only)', () => {
    show('[img]http://img.example.com/a/pic.png[/img]');
    expect(screen.queryByRole('img')).toBeNull();
    expect(out().querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: 'image: http://img.example.com/a/pic.png' });
    expect(link).toHaveAttribute('href', 'http://img.example.com/a/pic.png');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  test('code is shown as typed, in a pre', () => {
    show('[code][b]not bold[/b][/code]');
    expect(out().querySelector('pre code')).toHaveTextContent('[b]not bold[/b]');
    expect(out().querySelector('strong')).toBeNull();
  });

  test('lists, ordered and not', () => {
    show('[list][*]one[*]two[/list][list=1][*]first[/list]');
    expect(out().querySelectorAll('ul > li')).toHaveLength(2);
    expect(out().querySelectorAll('ol > li')).toHaveLength(1);
  });

  test('a quote is a blockquote around its words with the link the thread gives it', () => {
    const act = '11111111-1111-4111-8111-111111111111';
    show(`[quote=${act}]said this[/quote]after`, (q) => <a href={`#post-${q.kind === 'real' ? q.act.slice(0, 2) : ''}`}>Quoted post</a>);
    const q = out().querySelector('blockquote')!;
    expect(q).toHaveTextContent('said this');
    expect(q.querySelector('a')).toHaveAttribute('href', '#post-11');
    expect(out().textContent).toContain('after');
  });

  test('a quote with no resolver is still a blockquote, and says it quotes an earlier post', () => {
    show('[quote=11111111-1111-4111-8111-111111111111]x[/quote]');
    expect(out().querySelector('blockquote')).toHaveTextContent('x');
    expect(out().querySelector('cite')).toHaveTextContent('Quoting an earlier post');
  });

  describe('a counterfeit quote', () => {
    const user = '22222222-2222-4222-8222-222222222222';
    test('with no head given shows its typed name and letter, as plain text and never a link', () => {
      show('[quote=Geno]I never said that.[/quote]');
      const q = out().querySelector('blockquote')!;
      expect(q).toHaveAttribute('data-kb-counterfeit');
      expect(q.querySelector('cite')).toHaveTextContent('G' + 'Geno');
      expect(q.querySelector('cite .kb-byline-name')).toHaveTextContent('Geno');
      expect(q.querySelector('a')).toBeNull();
      expect(q).toHaveTextContent('I never said that.');
    });

    test('with no name says "Quote" and has no avatar; with only user= says "Someone"', () => {
      show('[quote]a[/quote][quote user=' + user + ']b[/quote]');
      const [bare, someone] = [...out().querySelectorAll('cite')];
      expect(bare).toHaveTextContent(/^Quote$/u);
      expect(bare!.querySelector('.kb-mini')).toBeNull();
      expect(someone).toHaveTextContent(/^Someone$/u);
    });

    test('is handed to the screen\'s head with the typed name and the user', () => {
      const seen: QuoteOf[] = [];
      show(`[quote="Geno Wario" user=${user}]x[/quote]`, (q) => { seen.push(q); return 'head'; });
      expect(seen).toEqual([{ kind: 'counterfeit', user, name: 'Geno Wario' }]);
    });

    test('is axe clean beside a real quote', async () => {
      show('[quote=11111111-1111-4111-8111-111111111111]x[/quote][quote=Geno]y[/quote]');
      const found = await axeViolations(out());
      expect(describeViolations(found)).toBe('');
    });
  });

  test('nesting deep enough for the parser\'s cap renders', () => {
    const open = '[quote=11111111-1111-4111-8111-111111111111]'.repeat(12) + 'bottom' + '[/quote]'.repeat(12);
    show(open);
    expect(out().querySelectorAll('blockquote')).toHaveLength(12);
    expect(out()).toHaveTextContent('bottom');
  });

  describe('spoilers', () => {
    test('a spoiler is a details element, shut, with its title as the summary', () => {
      show('before[spoiler=The ending]she wins[/spoiler]after');
      const d = out().querySelector('details.kb-bb-spoiler') as HTMLDetailsElement;
      expect(d).not.toBeNull();
      expect(d.open).toBe(false);
      expect(d.querySelector('summary')).toHaveTextContent('The ending');
      expect(d.querySelector('div')).toHaveTextContent('she wins');
    });

    test('a spoiler with no title says "Spoiler", and one inside another renders', () => {
      show('[spoiler=]a[spoiler=inner]b[/spoiler][/spoiler]');
      const all = out().querySelectorAll('details.kb-bb-spoiler');
      expect(all).toHaveLength(2);
      expect(all[0]!.querySelector(':scope > summary')).toHaveTextContent('Spoiler');
      expect(all[1]!.querySelector(':scope > summary')).toHaveTextContent('inner');
    });

    test('a spoiler title is text, never markup', () => {
      show('[spoiler=<b>x</b>]y[/spoiler]');
      expect(out().querySelector('summary')!.textContent).toBe('<b>x</b>');
      expect(out().querySelector('summary b')).toBeNull();
    });

    test('an inline spoiler is a shut button named "Spoiler" until it is pressed, and shuts again on a second press', () => {
      show('the answer is [ispoiler]42[/ispoiler] ok');
      const shut = screen.getByRole('button', { name: 'Spoiler' });
      expect(shut).toHaveAttribute('aria-expanded', 'false');
      expect(shut).toHaveAttribute('type', 'button');
      expect(shut).toHaveClass('kb-bb-ispoiler');
      fireEvent.click(shut);
      const open = screen.getByRole('button', { name: '42' });
      expect(open).toHaveAttribute('aria-expanded', 'true');
      expect(open).not.toHaveAttribute('aria-label');
      fireEvent.click(open);
      expect(screen.getByRole('button', { name: 'Spoiler' })).toHaveAttribute('aria-expanded', 'false');
    });

    test('a shut inline spoiler is named from its content, hides its words from the accessibility tree, and passes axe', async () => {
      show('the answer is [ispoiler]42[/ispoiler] ok');
      const shut = screen.getByRole('button', { name: 'Spoiler' });
      expect(shut).not.toHaveAttribute('aria-label');
      const words = within(shut).getByText('42');
      expect(words.closest('[aria-hidden="true"]')).not.toBeNull();
      const found = await axeViolations(out());
      expect(found, describeViolations(found)).toEqual([]);
      fireEvent.click(shut);
      const open = screen.getByRole('button', { name: '42' });
      expect(within(open).getByText('42').closest('[aria-hidden="true"]')).toBeNull();
      expect(open).not.toHaveTextContent('Spoiler');
    });

    test('a block tag inside an inline spoiler is the words as written', () => {
      show('[ispoiler][quote]x[/quote][/ispoiler]');
      expect(out().querySelector('blockquote')).toBeNull();
      expect(out().querySelector('.kb-bb-ispoiler [aria-hidden="true"]')!.textContent).toBe('[quote]x[/quote]');
    });

    test('a text layer\'s run inside a shut inline spoiler is drawn when it opens, and inside a spoiler too', () => {
      const run = (start: number, end: number): TextRun => ({
        start, end, key: `r${start}`, z: 0, mode: 'replace',
        render: ({ text, key }) => <mark key={key} data-covers={text}>dogs</mark>,
      });
      render(<RouterProvider><div data-testid="lay"><TextLayer runs={[run(2, 6), run(7, 11)]}><BbCode text={'a [ispoiler]cats[/ispoiler] [spoiler]cats[/spoiler]'} /></TextLayer></div></RouterProvider>);
      const lay = screen.getByTestId('lay');
      const button = screen.getByRole('button');
      expect(button.querySelector('mark')).toHaveAttribute('data-covers', 'cats');
      fireEvent.click(button);
      expect(screen.getByRole('button', { name: 'dogs' }).querySelector('mark')).not.toBeNull();
      expect(lay.querySelector('details mark')).toHaveAttribute('data-covers', 'cats');
    });

    test('both are axe clean, shut and open', async () => {
      show('[spoiler=Title]hidden [ispoiler]more[/ispoiler][/spoiler] and [ispoiler]x[/ispoiler]');
      expect(describeViolations(await axeViolations(out()))).toBe('');
      fireEvent.click(screen.getAllByRole('button')[0]!);
      out().querySelector('details')!.open = true;
      expect(describeViolations(await axeViolations(out()))).toBe('');
    });
  });
});

describe('an inline spoiler nests nothing interactive', () => {
  test('a link or a spoiler inside one is words, not an <a> or a button in the button', () => {
    const { container } = render(<BbCode text="[ispoiler][url=https://x.y]a[/url][/ispoiler] [ispoiler][ispoiler]a[/ispoiler]b[/ispoiler]" />);
    expect(container.querySelector('button a, button button')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  test('an empty one renders without error', () => {
    const { container } = render(<BbCode text="[ispoiler][/ispoiler]" />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  test('an open one keeps the board focus ring: no rule on it draws or removes an outline', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('engine/ui/bbcode/bbcode.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const bodies = [...css.matchAll(/([^{}]*\.kb-bb-ispoiler[^{}]*)\{([^}]*)\}/gu)].map((m) => m[2]!);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/outline/u);
  });
});

describe('layout and effects', () => {
  const css = async () => {
    const { readFileSync } = await import('node:fs');
    return readFileSync('engine/ui/bbcode/bbcode.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  };

  test('align is a block with its class; hr is a rule; sub and sup are their elements', () => {
    show('[center]a[/center][right]b[/right][left]l[/left][hr][sub]c[/sub][sup]d[/sup]');
    expect(out().querySelector('div.kb-bb-align-center')).toHaveTextContent('a');
    expect(out().querySelector('div.kb-bb-align-right')).toHaveTextContent('b');
    expect(out().querySelector('div.kb-bb-align-left')).toHaveTextContent('l');
    expect(out().querySelector('hr.kb-bb-hr')).not.toBeNull();
    expect(out().querySelector('sub')).toHaveTextContent('c');
    expect(out().querySelector('sup')).toHaveTextContent('d');
  });

  test('a font is a family from the list on a span, never the player\'s string', () => {
    show('[font=Impact]a[/font][font=Papyrus]b[/font]');
    const span = out().querySelector<HTMLElement>('span[style]')!;
    expect(span.style.fontFamily).toContain('Impact');
    expect(out().querySelectorAll('span[style]')).toHaveLength(1);
    expect(out().textContent).toBe('a[font=Papyrus]b[/font]');
  });

  test('glow and shadow are text-shadows, in the given color or else the page\'s ink', () => {
    show('[glow=red]a[/glow][shadow]b[/shadow][glow]c[/glow]');
    const spans = [...out().querySelectorAll<HTMLElement>('span.kb-bb-glow, span.kb-bb-shadow')];
    expect(spans.map((s) => s.className)).toEqual(['kb-bb-glow', 'kb-bb-shadow', 'kb-bb-glow']);
    expect(spans[0]!.getAttribute('style')).toMatch(/text-shadow:[^;]*red/u);
    expect(spans[1]!.getAttribute('style')).toContain('var(--kb-fg)');
    expect(spans[2]!.getAttribute('style')).toContain('var(--kb-fg)');
  });

  test('highlight takes black ink on yellow and white ink on navy, whichever reads better', () => {
    show('[highlight]a[/highlight][highlight=navy]b[/highlight][highlight=#ffeeaa]c[/highlight][highlight=#112]d[/highlight]');
    const marks = [...out().querySelectorAll<HTMLElement>('mark.kb-bb-highlight')];
    const inks = marks.map((m) => /color:\s*var\((--kb-ink-\w+)\)/u.exec(m.getAttribute('style')!.replace(/background[^;]*;?/u, ''))?.[1]);
    expect(inks).toEqual(['--kb-ink-black', '--kb-ink-white', '--kb-ink-black', '--kb-ink-white']);
    expect(marks[0]!.style.backgroundColor).toBe('yellow');
    expect(marks[1]!.style.backgroundColor).toBe('navy');
  });

  test('the ink tokens are black and white in both modes', async () => {
    const { readFileSync } = await import('node:fs');
    const tokens = readFileSync('engine/ui/tokens.css', 'utf8');
    expect(tokens).toMatch(/--kb-ink-black:\s*#000;/u);
    expect(tokens).toMatch(/--kb-ink-white:\s*#fff;/u);
  });

  test('a marquee is a block with a run inside it, and the run is the words', () => {
    show('[marquee]news[/marquee]');
    const box = out().querySelector('div.kb-bb-marquee')!;
    expect(box.querySelector('span.kb-bb-marquee-run')).toHaveTextContent('news');
  });

  test('a marquee moves by default, pauses on hover and focus, and is still when motion is reduced, whatever else', async () => {
    const sheet = await css();
    expect(sheet).toMatch(/@keyframes kb-bb-marquee/u);
    expect(sheet).toMatch(/\.kb-bb-marquee-run\s*\{[^}]*animation:[^}]*kb-bb-marquee/u);
    expect(sheet).toMatch(/\.kb-bb-marquee:hover[^{]*\{[^}]*animation-play-state:\s*paused/u);
    expect(sheet).toMatch(/\.kb-bb-marquee:focus-within[^{]*\{[^}]*animation-play-state:\s*paused/u);
    // Still for the device's setting unless the player chose full motion, and for the player's choice of reduced.
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*:not\(\[data-kb-motion="full"\]\)[^{]*\.kb-bb-marquee-run\s*\{[^}]*animation:\s*none/u);
    expect(sheet).toMatch(/\[data-kb-motion="reduce"\][^{]*\.kb-bb-marquee-run\s*\{[^}]*animation:\s*none/u);
    // Full motion is only ever the exemption from the device's setting, so it moves whatever the system says.
    for (const m of sheet.matchAll(/[^{}]*data-kb-motion="full"[^{}]*/gu)) expect(m[0]).toContain(':not([data-kb-motion="full"])');
  });

  test('rainbow is a gradient from the six tokens clipped to the text, plain under forced colors', async () => {
    show('[rainbow]hue[/rainbow]');
    expect(out().querySelector('span.kb-bb-rainbow')).toHaveTextContent('hue');
    const sheet = await css();
    const body = /\.kb-bb-rainbow\s*\{([^}]*)\}/u.exec(sheet)![1]!;
    for (let i = 1; i <= 6; i++) expect(body).toContain(`var(--kb-rainbow-${i})`);
    expect(body).toMatch(/background-clip:\s*text/u);
    expect(sheet).toMatch(/@media \(forced-colors: active\)\s*\{[^@]*\.kb-bb-rainbow\s*\{[^}]*background(-image)?:\s*none/u);
  });

  test('a marquee has a Pause / Play button that toggles it and carries the paused hook', async () => {
    show('[marquee]news[/marquee]');
    const btn = within(out().querySelector('.kb-bb-marquee')!).getByRole('button', { name: 'Pause' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(out().querySelector('.kb-bb-marquee')).not.toHaveAttribute('data-paused');
    fireEvent.click(btn);
    const play = within(out()).getByRole('button', { name: 'Play' });
    expect(play).toHaveAttribute('aria-pressed', 'true');
    expect(out().querySelector('.kb-bb-marquee')).toHaveAttribute('data-paused', '');
    fireEvent.click(play);
    expect(out().querySelector('.kb-bb-marquee')).not.toHaveAttribute('data-paused');
    expect(describeViolations(await axeViolations(out()))).toBe('');
    const sheet = await css();
    expect(sheet).toMatch(/\.kb-bb-marquee\[data-paused\][^{]*\{[^}]*animation-play-state:\s*paused/u);
    // Nothing moves under reduced motion, so the button is hidden there.
    expect(sheet).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*\.kb-bb-marquee-toggle\s*\{[^}]*display:\s*none/u);
    expect(sheet).toMatch(/\[data-kb-motion="reduce"\][^{]*\.kb-bb-marquee-toggle\s*\{[^}]*display:\s*none/u);
  });

  test('inside a rainbow, anything that paints its own color or background resets the transparent fill', async () => {
    show('[rainbow][highlight]x[/highlight][ispoiler]y[/ispoiler][color=red]z[/color][/rainbow]');
    const mark = out().querySelector('.kb-bb-rainbow mark.kb-bb-highlight');
    expect(mark).toHaveTextContent('x');
    expect(out().querySelector('.kb-bb-rainbow button.kb-bb-ispoiler')).not.toBeNull();
    const sheet = await css();
    const m = /\.kb-bb-rainbow\s+:where\(([^)]*)\)[^{]*\{([^}]*)\}/u.exec(sheet)!;
    expect(m).not.toBeNull();
    for (const sel of ['mark', 'button', 'a', '[style*="color"]']) expect(m[1]).toContain(sel);
    expect(m[2]).toMatch(/-webkit-text-fill-color:\s*currentcolor/u);
  });

  test('text layers draw inside every container', () => {
    const run: TextRun = { start: 0, end: 4, key: 'r', z: 0, mode: 'replace', render: ({ text, key }) => <b key={key} data-covers={text}>dogs</b> };
    const wrap = (t: string) => render(<RouterProvider><div data-testid="lay"><TextLayer runs={[run]}><BbCode text={t} /></TextLayer></div></RouterProvider>);
    for (const t of ['[center]cats[/center]', '[marquee]cats[/marquee]', '[sub]cats[/sub]', '[font=Arial]cats[/font]', '[glow]cats[/glow]', '[rainbow]cats[/rainbow]', '[highlight]cats[/highlight]']) {
      const { unmount } = wrap(t);
      expect(screen.getByTestId('lay').querySelector('b[data-covers]'), t).toHaveAttribute('data-covers', 'cats');
      unmount();
    }
  });

  test('noparse draws as plain text, and a text layer covers its words', () => {
    show('a[noparse][b]x[/b][/noparse]c');
    expect(out()).toHaveTextContent('a[b]x[/b]c');
    expect(out().querySelector('strong')).toBeNull();
    const run: TextRun = { start: 1, end: 4, key: 'r', z: 0, mode: 'replace', render: ({ text, key }) => <b key={key} data-covers={text}>dogs</b> };
    render(<RouterProvider><div data-testid="lay2"><TextLayer runs={[run]}><BbCode text="a[noparse]cats[/noparse]" /></TextLayer></div></RouterProvider>);
    expect(screen.getByTestId('lay2').querySelector('b[data-covers]')).toHaveAttribute('data-covers', 'cat');
  });

  test('a bare address is a link a reader\'s link is, its words kept; a text layer covers it', () => {
    show('see https://x.example/a?q=1#f. ok [ispoiler]https://s.example[/ispoiler]');
    const links = out().querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://x.example/a?q=1#f');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(links[0]).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(links[0]).toHaveTextContent('https://x.example/a?q=1#f');
    expect(out()).toHaveTextContent('see https://x.example/a?q=1#f. ok https://s.example');
    expect(out().querySelector('button a')).toBeNull();
    const run: TextRun = { start: 4, end: 21, key: 'r', z: 0, mode: 'replace', render: ({ text, key }) => <b key={key} data-covers={text}>dogs</b> };
    render(<RouterProvider><div data-testid="lay3"><TextLayer runs={[run]}><BbCode text="see https://x.example/a ok" /></TextLayer></div></RouterProvider>);
    expect(screen.getByTestId('lay3').querySelector('b[data-covers]')).toHaveAttribute('data-covers', 'https://x.example/a'.slice(0, 17));
  });

  describe('a wrap run\'s trail', () => {
    const wrapRun = (start: number, end: number, key: string, z = 0, trail?: (k: string) => React.ReactNode): TextRun => ({
      start, end, key, z, mode: 'wrap', render: ({ text, key: k }) => <i key={k}>{text}</i>, ...(trail ? { trail } : {}),
    });
    const trailOf = (name: string) => (k: string) => <span key={k} data-trail={name} />;
    const draw = (runs: TextRun[], text: string) => {
      render(<RouterProvider><div data-testid="tr"><TextLayer runs={runs}><BbCode text={text} /></TextLayer></div></RouterProvider>);
      return screen.getByTestId('tr');
    };
    const trailsIn = (el: HTMLElement) => [...el.querySelectorAll('[data-trail]')].map((t) => t.getAttribute('data-trail'));

    test('is drawn once, between the run\'s last word and what follows', () => {
      const el = draw([wrapRun(7, 15, 'r', 0, trailOf('t'))], 'I love big cats today');
      expect(trailsIn(el)).toEqual(['t']);
      expect(el.querySelector('.kb-bb')!.innerHTML).toMatch(/cats<\/i><span data-trail="t"><\/span> today/u);
    });

    test('sits inside the formatting of the run\'s last piece', () => {
      const el = draw([wrapRun(7, 15, 'r', 0, trailOf('t'))], 'I love big [b]cats[/b] today');
      const strong = el.querySelector('strong')!;
      expect(strong.querySelector('[data-trail="t"]')).not.toBeNull();
      expect(strong.innerHTML).toMatch(/cats<\/i><span data-trail="t"><\/span>$/u);
      expect(trailsIn(el)).toEqual(['t']);
    });

    test('is not drawn where a higher replace run covers the run\'s end', () => {
      const cover: TextRun = { start: 11, end: 15, key: 'c', z: 0, mode: 'replace', render: ({ key }) => <b key={key}>X</b> };
      const el = draw([wrapRun(7, 15, 'r', 0, trailOf('t')), cover], 'I love big cats today');
      expect(el.querySelector('b')).toHaveTextContent('X');
      expect(trailsIn(el)).toEqual([]);
    });

    test('of two touching wrap runs are both drawn, in order', () => {
      const el = draw([wrapRun(2, 6, 'a', 0, trailOf('a')), wrapRun(6, 10, 'b', 0, trailOf('b'))], 'I love big cats today');
      expect(trailsIn(el)).toEqual(['a', 'b']);
      expect(el.querySelector('.kb-bb')!.innerHTML).toMatch(/<span data-trail="a"><\/span><i>[^<]*<\/i><span data-trail="b">/u);
    });

    test('is absent from a run that has none: it draws what it always drew', () => {
      const el = draw([wrapRun(7, 15, 'r')], 'I love big cats today');
      expect(trailsIn(el)).toEqual([]);
      expect(el.querySelector('.kb-bb')!.innerHTML).toBe('I love <i>big cats</i> today');
    });
  });

  test('all of them are axe clean', async () => {
    show('[center]a[/center][hr][sub]b[/sub][sup]c[/sup][font=Georgia]d[/font][marquee]e[/marquee][glow=red]f[/glow][shadow]g[/shadow][rainbow]h[/rainbow][highlight]i[/highlight][noparse][b]j[/b][/noparse]');
    expect(describeViolations(await axeViolations(out()))).toBe('');
  });
});
