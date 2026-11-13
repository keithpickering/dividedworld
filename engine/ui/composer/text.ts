/**
 * What a toolbar press does to the draft: pure functions from the text and the selection to the new
 * text and the selection after. The box applies the result; nothing here touches the page.
 */
import { parse, type BbNode } from '../../bbcode/parse.ts';

export type Tool = 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'image' | 'code' | 'list' | 'spoiler' | 'video';

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
  if (tool === 'spoiler') {
    const selected = text.slice(start, end);
    if (selected !== '' && !selected.includes('\n')) return wrap(text, start, end, '[ispoiler]', '[/ispoiler]');
    /* Anything else is the toggle; the cursor waits where its text goes. */
    const at = start + '[spoiler='.length;
    return { text: `${text.slice(0, start)}[spoiler=]${selected}[/spoiler]${text.slice(end)}`, start: at, end: at };
  }
  if (tool === 'video') {
    if (/^https?:\/\/\S+$/u.test(text.slice(start, end))) return wrap(text, start, end, '[video]', '[/video]');
    /* Words selected are not a video: they stay, and the bare tag goes in after them. */
    const at = end + '[video]'.length;
    return { text: `${text.slice(0, end)}[video][/video]${text.slice(end)}`, start: at, end: at };
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

/**
 * The selection wrapped as a counterfeit quote of a character: `[quote=<name> user=<id>]`. A name with a space or `=` is quoted so the parser reads it whole;
 * one with a `"` in it is left bare (the parser's quoted form cannot hold one), which reads back whole unless it begins with one.
 */
export function quoteSomeone(text: string, start: number, end: number, character: { readonly id: string; readonly name: string }): Edited {
  const name = /[\s=]/u.test(character.name) && !character.name.includes('"') ? `"${character.name}"` : character.name;
  const named = `[quote=${name} user=${character.id}]`;
  /* A name the parser would not read back as exactly this counterfeit (a `]` ends the tag early, a `[` or a lone leading `"` makes the opener text, an Act id reads as a real quote) is left out: the head names the character from the id. */
  const back = parse(`${named}x[/quote]`);
  const whole = back.length === 1 && back[0]!.type === 'counterfeit' && back[0]!.name === character.name && back[0]!.user === character.id;
  return wrap(text, start, end, whole ? named : `[quote user=${character.id}]`, '[/quote]');
}

/**
 * The characters a draft puts words in the mouth of: the distinct `user` ids of its counterfeit quotes (a quote with a typed name, or none, and `user=<id>`), in the
 * order they are named, at most `FRAMED_MOST`. A real quote of an Act, and a counterfeit that names no character, add none. The server looks at no more than five.
 */
export const FRAMED_MOST = 5;
export function framedIn(draft: string): string[] {
  const found = new Set<string>();
  const walk = (nodes: readonly BbNode[]) => {
    for (const n of nodes) {
      if (found.size >= FRAMED_MOST) return;
      if (n.type === 'counterfeit' && n.user !== null) found.add(n.user);
      if ('children' in n) walk(n.children);
    }
  };
  walk(parse(draft));
  return [...found];
}

/** The trailing `framing` argument of a send: the draft's framed characters, or no argument at all when it frames none. */
export const framingArgs = (draft: string): [readonly string[]] | [] => { const f = framedIn(draft); return f.length > 0 ? [f] : []; };

/**
 * A selection's words as the quote keeps them: as typed. Words that would read as a tag (`[b]`, `[/quote]`, `[url=...]`) go in `[noparse]`, so the quote holds
 * no markup the post did not show. The cover ends at the first `[/noparse]`, so one inside the words is cut in two there (its `]` goes to a cover of its own),
 * which reads back as the same characters and can never end the cover early.
 */
function asTyped(words: string): string {
  if (!/\[\/?[a-z*]/iu.test(words)) return words;
  return `[noparse]${words.replace(/\[\/noparse\]/giu, (closer) => `${closer.slice(0, -1)}[/noparse][noparse]]`)}[/noparse]`;
}

/**
 * The draft with a quote of an Act appended on a line of its own: the whole post by its Act, whose markup stays live as written,
 * or, with `selected`, a stretch of its shown words, kept as typed.
 */
export function quoteText(draft: string, act: string, body: string, selected = false): string {
  const lead = draft === '' || draft.endsWith('\n') ? draft : `${draft}\n`;
  return `${lead}[quote=${act}]${selected ? asTyped(body) : body}[/quote]\n`;
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

/** Whether a tree holds a `cut` (a real quote nested past the parser's cap) at any depth. Walks with its own stack, so no tree is deep enough to matter. */
export function hasCut(tree: readonly BbNode[]): boolean {
  const stack: BbNode[] = [...tree];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === 'cut') return true;
    if ('children' in n) stack.push(...n.children);
    else if (n.type === 'list') for (const item of n.items) stack.push(...item);
  }
  return false;
}
