/**
 * What a toolbar press does to the draft: pure functions from the text and the selection to the new
 * text and the selection after. The box applies the result; nothing here touches the page.
 */
export type Tool = 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'image' | 'code' | 'list';

export interface Edited {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const TAGS: Record<'bold' | 'italic' | 'underline' | 'strike' | 'image' | 'code', readonly [string, string]> = {
  bold: ['[b]', '[/b]'],
  italic: ['[i]', '[/i]'],
  underline: ['[u]', '[/u]'],
  strike: ['[s]', '[/s]'],
  image: ['[img]', '[/img]'],
  code: ['[code]', '[/code]'],
};

function wrap(text: string, start: number, end: number, open: string, close: string): Edited {
  return { text: text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end), start: start + open.length, end: end + open.length };
}

export function applyTool(tool: Tool, text: string, start: number, end: number): Edited {
  if (tool === 'link') {
    const selected = text.slice(start, end);
    if (/^https?:\/\/\S+$/u.test(selected)) return wrap(text, start, end, '[url]', '[/url]');
    /* Other words are the link's text; the cursor waits where the address goes. */
    const at = start + '[url='.length;
    return { text: `${text.slice(0, start)}[url=]${selected}[/url]${text.slice(end)}`, start: at, end: at };
  }
  if (tool === 'list') {
    const selected = text.slice(start, end);
    if (selected === '') {
      const open = '[list]\n[*]';
      return { text: `${text.slice(0, start)}${open}\n[/list]${text.slice(end)}`, start: start + open.length, end: start + open.length };
    }
    const block = `[list]\n${selected.split('\n').map((line) => `[*]${line}`).join('\n')}\n[/list]`;
    return { text: text.slice(0, start) + block + text.slice(end), start: start + block.length, end: start + block.length };
  }
  const [open, close] = TAGS[tool];
  return wrap(text, start, end, open, close);
}

/** The draft with a quote of an Act appended on a line of its own: the whole post, by its Act. */
export function quoteText(draft: string, act: string, body: string): string {
  const lead = draft === '' || draft.endsWith('\n') ? draft : `${draft}\n`;
  return `${lead}[quote=${act}]${body}[/quote]\n`;
}

/**
 * What differs between two texts as one replacement: the span of `before` from `start` to `end`
 * becomes `insert`. The box applies a toolbar press or a quote as that one insertion so the
 * browser keeps its undo; a pair of surrogates is never split.
 */
export function diffRange(before: string, after: string): { readonly start: number; readonly end: number; readonly insert: string } {
  const surrogate = (s: string, i: number) => i > 0 && i < s.length && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff;
  let start = 0;
  const most = Math.min(before.length, after.length);
  while (start < most && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  while (start > 0 && surrogate(before, start)) start -= 1;
  let end = before.length;
  let tail = after.length;
  while (end > start && tail > start && before.charCodeAt(end - 1) === after.charCodeAt(tail - 1)) { end -= 1; tail -= 1; }
  while (tail < after.length && (surrogate(before, end) || surrogate(after, tail))) { end += 1; tail += 1; }
  return { start, end, insert: after.slice(start, tail) };
}
