import { describe, expect, test } from 'vitest';
import { applyTool, diffRange, framedIn, quoteText } from './text.ts';

describe('what a toolbar press does to the text', () => {
  test('wraps the selection and keeps it selected inside the tags', () => {
    expect(applyTool('bold', 'a loud word', 2, 6)).toEqual({ text: 'a [b]loud[/b] word', start: 5, end: 9 });
    expect(applyTool('strike', 'x', 0, 1).text).toBe('[s]x[/s]');
    expect(applyTool('underline', 'x', 0, 1).text).toBe('[u]x[/u]');
    expect(applyTool('italic', 'x', 0, 1).text).toBe('[i]x[/i]');
    expect(applyTool('code', 'x', 0, 1).text).toBe('[code]x[/code]');
    expect(applyTool('image', 'https://a.test/i.png', 0, 20).text).toBe('[img]https://a.test/i.png[/img]');
  });
  test('with nothing selected puts the cursor between the tags', () => {
    expect(applyTool('bold', 'ab', 1, 1)).toEqual({ text: 'a[b][/b]b', start: 4, end: 4 });
  });
  test('a link: an address selected is the link, other words get an address to fill in, nothing selected a bare tag', () => {
    expect(applyTool('link', 'see https://a.test now', 4, 18).text).toBe('see [url]https://a.test[/url] now');
    expect(applyTool('link', 'see here', 4, 8)).toEqual({ text: 'see [url=]here[/url]', start: 9, end: 9 });
    expect(applyTool('link', '', 0, 0)).toEqual({ text: '[url=][/url]', start: 5, end: 5 });
  });
  test('a list: each selected line is an item', () => {
    expect(applyTool('list', 'one\ntwo', 0, 7).text).toBe('[list]\n[*]one\n[*]two\n[/list]');
    expect(applyTool('list', '', 0, 0).text).toBe('[list]\n[*]\n[/list]');
  });
  test('a quote text is the whole post by its Act, appended on a line of its own', () => {
    expect(quoteText('', 'id1', 'words')).toBe('[quote=id1]words[/quote]\n');
    expect(quoteText('mine', 'id1', 'words')).toBe('mine\n[quote=id1]words[/quote]\n');
    expect(quoteText('mine\n', 'id1', 'words')).toBe('mine\n[quote=id1]words[/quote]\n');
  });
});

describe('diffRange', () => {
  test('is the one replacement that turns one text into the other', () => {
    for (const [before, after] of [['hi', '[b]hi[/b]'], ['make this loud', 'make [b]this[/b] loud'], ['', 'abc'], ['abc', ''], ['aaa', 'aaaa'], ['a😀b', 'a😁b'], ['x😀', 'x😀😀']] as const) {
      const d = diffRange(before, after);
      expect(before.slice(0, d.start) + d.insert + before.slice(d.end)).toBe(after);
    }
    expect(diffRange('hi', '[b]hi[/b]')).toEqual({ start: 0, end: 2, insert: '[b]hi[/b]' });
    expect(diffRange('abc\n', 'abc\n[quote=1]q[/quote]\n')).toEqual({ start: 4, end: 4, insert: '[quote=1]q[/quote]\n' });
  });
});

describe('framedIn: the characters a draft puts words in the mouth of', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const ACT = '33333333-3333-4333-8333-333333333333';
  test('is the distinct user ids of its counterfeits, in the order named', () => {
    expect(framedIn(`[quote=Ana user=${A}]a[/quote] and [quote=Bo user=${B}]b[/quote]`)).toEqual([A, B]);
  });
  test('names a repeated id once, and finds one inside another quote', () => {
    expect(framedIn(`[quote user=${A}]x[/quote][quote=Ana user=${A}]y[/quote]`)).toEqual([A]);
    expect(framedIn(`[quote=Bo user=${B}][quote=Ana user=${A}]in[/quote][/quote]`)).toEqual([B, A]);
  });
  test('ignores a real quote of an Act, a hand-typed counterfeit with no user, and plain text', () => {
    expect(framedIn(`[quote=${ACT}]real[/quote]`)).toEqual([]);
    expect(framedIn('[quote=Ana]typed by hand[/quote]')).toEqual([]);
    expect(framedIn('no tags, though user=' + A)).toEqual([]);
  });
  test('names at most five', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`);
    expect(framedIn(ids.map((i) => `[quote user=${i}]x[/quote]`).join(''))).toEqual(ids.slice(0, 5));
  });
});
