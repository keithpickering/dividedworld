import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BbCode } from './render.tsx';
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
});
