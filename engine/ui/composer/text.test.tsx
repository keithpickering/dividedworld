import { describe, expect, test } from 'vitest';
import { applyTool, diffRange, quoteText } from './text.ts';

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
