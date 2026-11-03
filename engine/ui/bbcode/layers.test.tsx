import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BbCode } from './render.tsx';
import { TextLayer, stretchesOf, type TextRun } from './layers.tsx';
import { RouterProvider } from '../router.tsx';
import { parse } from '../../bbcode/parse.ts';
import { visibleText } from '../../bbcode/visible.ts';

const ACT = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** A replace run that draws a strip with the word it stands for. */
const strip = (from: number, to: number, said: string, z = 0): TextRun => ({
  from, to, key: `s${from}-${to}-${z}`, z, mode: 'replace',
  render: ({ text, key }) => <mark key={key} data-strip={said} data-covers={text}>{said}</mark>,
});
/** A wrap run that draws each piece inside a band. */
const band = (from: number, to: number, z = 0): TextRun => ({
  from, to, key: `b${from}-${to}-${z}`, z, mode: 'wrap',
  render: ({ text, key }) => <i key={key} data-band="">{text}</i>,
});

const show = (text: string, runs: readonly TextRun[]) =>
  render(<RouterProvider><div data-testid="out"><TextLayer runs={runs}><BbCode text={text} /></TextLayer></div></RouterProvider>);
const out = () => screen.getByTestId('out');
const at = (text: string, word: string) => visibleText(parse(text)).indexOf(word);

describe('text layers', () => {
  test('a replace run across formatting is drawn once, and none of its words are drawn by the post', () => {
    const text = 'my ca[b]ts[/b] are here';
    const from = at(text, 'cats');
    show(text, [strip(from, from + 4, 'dogs')]);
    const strips = out().querySelectorAll('[data-strip]');
    expect(strips).toHaveLength(1);
    expect(strips[0]!.getAttribute('data-covers')).toBe('cats');
    expect(out().textContent).toBe('my dogs are here');
    expect(out().querySelector('strong')?.textContent ?? '').toBe('');
  });

  test('a wrap run draws each piece inside its own formatting, and skips nothing', () => {
    const text = 'my ca[b]ts[/b] are here';
    const from = at(text, 'cats');
    show(text, [band(from, from + 4)]);
    const bands = [...out().querySelectorAll('[data-band]')].map((b) => b.textContent);
    expect(bands).toEqual(['ca', 'ts']);
    expect(out().querySelector('strong [data-band]')?.textContent).toBe('ts');
    expect(out().textContent).toBe('my cats are here');
  });

  test('where runs overlap, the higher one is drawn over the overlap, and the lower one only outside it', () => {
    const text = 'a big cats day';
    const big = at(text, 'big cats');
    const cats = at(text, 'cats');
    show(text, [strip(big, big + 8, 'LOW', 0), strip(cats, cats + 4, 'TOP', 1)]);
    expect([...out().querySelectorAll('[data-strip]')].map((s) => [s.getAttribute('data-strip'), s.getAttribute('data-covers')]))
      .toEqual([['LOW', 'big '], ['TOP', 'cats']]);
    expect(out().textContent).toBe('a LOWTOP day');
  });

  test('a replace run wins over a wrap run where they overlap', () => {
    const text = 'one two three';
    show(text, [band(0, 7, 5), strip(at(text, 'two'), at(text, 'two') + 3, 'TWO', 0)]);
    expect([...out().querySelectorAll('[data-band]')].map((b) => b.textContent)).toEqual(['one ']);
    expect(out().textContent).toBe('one TWO three');
  });

  test('a quote\'s words are never under a run, and the offsets after it agree with the visible text', () => {
    const text = `cats [quote=${ACT}]cats[/quote] cats`;
    const seen = visibleText(parse(text));
    const last = seen.lastIndexOf('cats');
    show(text, [strip(0, 4, 'A'), strip(last, last + 4, 'B')]);
    expect(out().querySelector('blockquote')?.textContent).toContain('cats');
    expect([...out().querySelectorAll('[data-strip]')].map((s) => s.getAttribute('data-strip'))).toEqual(['A', 'B']);
  });

  test('offsets agree with the visible text on a post holding every kind of node', () => {
    const text = `[i]alpha[/i] [color=red]beta[/color] [size=3]gamma[/size] [url=https://a.example]link[/url] [img]https://a.example/i.png[/img] `
      + `[code]code[/code] [list][*]delta[*][u]epsilon[/u][/list] [s]zeta[/s] [quote=${ACT}]quoted[/quote] eta [b]unclosed theta`;
    const seen = visibleText(parse(text));
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    show(text, words.map((w) => { const i = seen.indexOf(w === 'eta' ? ' eta ' : w) + (w === 'eta' ? 1 : 0); return strip(i, i + w.length, w.toUpperCase()); }));
    expect([...out().querySelectorAll('[data-strip]')].map((s) => s.getAttribute('data-covers'))).toEqual(words);
  });

  test('with no layers, the post draws exactly as before', () => {
    const text = 'plain [b]bold[/b] words';
    const plain = render(<RouterProvider><BbCode text={text} /></RouterProvider>).container.innerHTML;
    const layered = render(<RouterProvider><TextLayer runs={[]}><BbCode text={text} /></TextLayer></RouterProvider>).container.innerHTML;
    expect(layered).toBe(plain);
  });

  test('stretches: each stretch names its top run, and a run split by a higher one gives two stretches', () => {
    const low = strip(0, 10, 'L', 0);
    const top = strip(3, 5, 'T', 1);
    expect(stretchesOf(12, [low, top]).map((s) => [s.from, s.to, s.run?.key ?? null]))
      .toEqual([[0, 3, low.key], [3, 5, top.key], [5, 10, low.key], [10, 12, null]]);
  });
});
