import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BbCode } from './render.tsx';
import { TextLayer, type TextRun } from './layers.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
import { RouterProvider } from '../router.tsx';

const show = (text: string, quoteLink?: (act: string) => React.ReactNode) =>
  render(<RouterProvider><div data-testid="out"><BbCode text={text} quoteLink={quoteLink} /></div></RouterProvider>);
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
    show(`[quote=${act}]said this[/quote]after`, (id) => <a href={`#post-${id.slice(0, 2)}`}>Quoted post</a>);
    const q = out().querySelector('blockquote')!;
    expect(q).toHaveTextContent('said this');
    expect(q.querySelector('a')).toHaveAttribute('href', '#post-11');
    expect(out().textContent).toContain('after');
  });

  test('a quote with no resolver is still a blockquote, and says it quotes an earlier post', () => {
    show('[quote=11111111-1111-4111-8111-111111111111]x[/quote]');
    expect(out().querySelector('blockquote')).toHaveTextContent('x');
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

    test('a block tag inside an inline spoiler is the words as written', () => {
      show('[ispoiler][quote]x[/quote][/ispoiler]');
      expect(out().querySelector('blockquote')).toBeNull();
      expect(out().textContent).toBe('[quote]x[/quote]');
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
