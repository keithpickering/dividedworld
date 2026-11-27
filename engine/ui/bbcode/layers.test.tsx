import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { BbCode } from './render.tsx';
import { TextLayer, stretchesOf, type TextRun } from './layers.tsx';
import { RouterProvider } from '../router.tsx';
import { parse } from '../../bbcode/parse.ts';
import { visibleText } from '../../bbcode/visible.ts';

const ACT = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** A replace run that draws a strip with the word it stands for. */
const strip = (start: number, end: number, said: string, z = 0): TextRun => ({
  start, end, key: `s${start}-${end}-${z}`, z, mode: 'replace',
  render: ({ text, key }) => <mark key={key} data-strip={said} data-covers={text}>{said}</mark>,
});
/** A wrap run that draws each piece inside a band. */
const band = (start: number, end: number, z = 0): TextRun => ({
  start, end, key: `b${start}-${end}-${z}`, z, mode: 'wrap',
  render: ({ text, key }) => <i key={key} data-band="">{text}</i>,
});

/** A mark run: nothing at all in the words, an empty element at one offset. */
const mark = (start: number, id: string, z = 0): TextRun => ({
  start, end: start, key: `m${start}-${id}`, z, mode: 'mark',
  render: ({ key }) => <span key={key} data-mark={id} />,
});
/** A wrap run that stands a trail after its words. */
const trailing = (start: number, end: number, id: string): TextRun => ({
  ...band(start, end), key: `t${start}-${end}-${id}`, stands: true,
  trail: (key) => <b key={key} data-trail={id} />,
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

  test('a replace run split by a higher one is drawn as a piece on each side of it, each once, with no duplicate keys', () => {
    const errors: unknown[] = [];
    const was = console.error;
    console.error = (...a: unknown[]) => { errors.push(a); };
    try {
      const text = 'a big fat cats day';
      const low = at(text, 'big fat cats');
      const fat = at(text, 'fat');
      show(text, [strip(low, low + 12, 'LOW', 0), strip(fat, fat + 3, 'TOP', 1)]);
      expect([...out().querySelectorAll('[data-strip]')].map((s) => [s.getAttribute('data-strip'), s.getAttribute('data-covers')]))
        .toEqual([['LOW', 'big '], ['TOP', 'fat'], ['LOW', ' cats']]);
    } finally {
      console.error = was;
    }
    expect(errors).toEqual([]);
  });

  test('of two runs of a kind at one height, the later one is drawn', () => {
    const text = 'one two';
    show(text, [strip(0, 3, 'FIRST', 0), strip(0, 3, 'SECOND', 0)]);
    expect([...out().querySelectorAll('[data-strip]')].map((s) => s.getAttribute('data-strip'))).toEqual(['SECOND']);
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
    expect(stretchesOf(12, [low, top]).map((s) => [s.start, s.end, s.run?.key ?? null]))
      .toEqual([[0, 3, low.key], [3, 5, top.key], [5, 10, low.key], [10, 12, null]]);
  });

  describe('a mark run', () => {
    /** The element names and texts of what `out` holds, in order, flattened: a marker is written as `|id|`. */
    const flat = (el: Element): string => [...el.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : (n as Element).hasAttribute('data-mark') ? `|${(n as Element).getAttribute('data-mark')}|` : (n as Element).hasAttribute('data-trail') ? `<${(n as Element).getAttribute('data-trail')}>` : `(${(n as Element).tagName.toLowerCase()} ${flat(n as Element)})`)).join('');

    test('at an offset inside a bold word draws an element between the right characters, inside the bold, and the words are as they were', () => {
      const text = 'my [b]cats[/b] here';
      const o = at(text, 'cats') + 2;
      show(text, [mark(o, 'm')]);
      expect(out().querySelector('strong')!.innerHTML).toBe('ca<span data-mark="m"></span>ts');
      expect(out().textContent).toBe('my cats here');
      expect(out().querySelectorAll('[data-mark]')).toHaveLength(1);
    });

    test('does not change which run draws the words: a wrap run still draws each piece, split at the mark', () => {
      const text = 'my cats here';
      const from = at(text, 'cats');
      show(text, [band(from, from + 4), mark(from + 2, 'm')]);
      expect([...out().querySelectorAll('[data-band]')].map((b) => b.textContent)).toEqual(['ca', 'ts']);
      expect(flat(out().firstElementChild!)).toBe('my (i ca)|m|(i ts) here');
    });

    test('at an offset a replace run covers is still drawn, and the run still draws its words once', () => {
      const text = 'my cats here';
      const from = at(text, 'cats');
      show(text, [strip(from, from + 4, 'dogs'), mark(from + 2, 'm')]);
      expect(out().querySelectorAll('[data-strip]')).toHaveLength(1);
      expect(out().querySelectorAll('[data-mark]')).toHaveLength(1);
      expect(out().textContent).toBe('my dogs here');
    });

    test('at the start of the words, at their end, and in a gap the walk puts for a quote, each draws once', () => {
      const text = `one [quote=${ACT}]quoted[/quote] two`;
      const seen = visibleText(parse(text));
      show(text, [mark(0, 'start'), mark(seen.length, 'end'), mark(seen.indexOf('two') - 1, 'gap')]);
      expect([...out().querySelectorAll('[data-mark]')].map((m) => m.getAttribute('data-mark')).sort()).toEqual(['end', 'gap', 'start']);
    });

    test('at an offset where a standing trail is drawn comes after that trail, and marks at one offset go by z then list order', () => {
      const text = 'my cats here';
      const from = at(text, 'cats');
      show(text, [mark(from + 4, 'late', 1), mark(from + 4, 'early', 0), trailing(from, from + 4, 'T')]);
      expect(flat(out().firstElementChild!)).toBe('my (i cats)<T>|early||late| here');
    });

    test('a mark never changes the stretches: stretchesOf ignores it', () => {
      const low = band(0, 10);
      expect(stretchesOf(12, [low, mark(3, 'm'), mark(0, 'z')]).map((s) => [s.start, s.end, s.run?.key ?? null])).toEqual([[0, 10, low.key], [10, 12, null]]);
    });

    test('a post with a mark and no other run draws the same words as one with none', () => {
      const text = 'plain [b]bold[/b] words';
      const plain = show(text, []).container.textContent;
      cleanup();
      const marked = show(text, [mark(8, 'm')]).container.textContent;
      expect(marked).toBe(plain);
    });
  });
});
