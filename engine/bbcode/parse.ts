/**
 * BBCode to a tree of allowlisted nodes. Parsing only: nothing here renders, and nothing here
 * produces markup.
 *
 * The tree is the safety boundary. A renderer that handles exactly the node types below, and
 * escapes every `text` and `code` string, cannot emit script: every address in the tree was
 * checked here (`href` and `src` are http, https, mailto or a site-relative path, with no
 * control characters, whitespace, quotes or angle brackets), every color is a named color or
 * hex, every size is a whole number from 1 to 7, and an Act is named by a well-formed UUID.
 * Anything the allowlist does not cover is not an error and is not dropped: it stays in the
 * tree as text, exactly as the player wrote it ("The System acts; it never destroys what a
 * player wrote"). That includes a link with a `javascript:` target, an image with a `data:`
 * source, an unknown tag and HTML.
 *
 * Malformed input closes safely:
 * - An opening tag whose attribute fails its check becomes text, and so does its closing tag,
 *   so `[url=javascript:x]a[/url]` comes back as that exact string. (The parser keeps a marker
 *   for such a tag on its stack so a later closer cannot be matched to the wrong opener.)
 * - A tag left open at the end closes there and keeps its words. A bare `[url]` left open
 *   falls back to text, since its target is its contents and nothing closed it.
 * - A closer closes the nearest matching opener and, with it, anything opened inside that was
 *   never closed. `[b][i]x[/b]y[/i]` is bold italic `x`, then the text `y[/i]`. A closer with
 *   nothing open to close is text.
 * - `[video]` and `[youtube]` are taken the same way as `[img]`; the contents must be an address
 *   engine/bbcode/video.ts has a player for (`[youtube]` also takes a bare id), else only the opener is text.
 * - `[code]` and `[img]` take their contents raw up to the closing tag. With no closing tag,
 *   an attribute, or (for an image) contents that are not an http or https address, only the
 *   opening tag is text, and what follows parses as usual.
 * - A link opened while another link is open closes the open one first, with whatever was
 *   opened inside it, so no anchor nests (that is not valid markup). Nothing is lost: a forgotten
 *   `[/url]` costs nothing, and a properly nested pair costs only the outer link's stray closer,
 *   which stays text. A link that is text (bad target) is not a link and blocks nothing. An image
 *   inside a link is fine: it is a node of its own with a checked source.
 * - `[quote]` is a real quote only when its name is an Act's UUID. Any other name (at most
 *   `MAX_QUOTE_NAME` characters), a bare `[quote]` or `[quote user=<uuid>]` is a `counterfeit`: its
 *   words are the post's own and it names no Act, so the renderer must never draw one as an Act's
 *   words. A `user=` that is not a UUID, a longer name or an empty one makes the opener text.
 * - `[spoiler=title]` is a block with a plain-text title (at most `MAX_SPOILER_TITLE` characters,
 *   "Spoiler" when none or an empty one is given; a longer one makes the opener text). `[ispoiler]`
 *   is inline and holds inline formatting only: while one is open, the opener of a block tag (`BLOCK`)
 *   is text, and so is its closer, so a closer inside cannot close a block opened outside. It is
 *   drawn as a button, so nothing interactive nests in it either: while one is open, a `[url]` opener
 *   and an `[ispoiler]` opener are text (the same count, `openISpoilers`), and so is `[/url]`. A
 *   `[/ispoiler]` still closes the open spoiler, else it could never end. An ispoiler's text is never
 *   auto-linked: the autolink pass (Task 5) must skip text inside an `ispoiler` node.
 * - `[noparse]` is taken raw as `[code]` is, but gives a `text` node: its words are the post's own, shown as written. `[hr]` is a
 *   leaf with no closer (a `[/hr]` is text), and `[font=name]` takes a name from `FONTS` only, so no free text reaches a style.
 * - A list's `[*]` is an item marker only directly inside `[list]`; elsewhere it is text.
 *   Blank space before the first item is layout and is not kept; words before it become an
 *   item of their own.
 *
 * The work is bounded, because the input is any player's post (design, "Weigh a design at the
 * scale of a busy instance"). The parser is one pass with an explicit stack, never recursion,
 * so 10,000 nested tags cannot blow the stack. Nesting is capped at `MAX_DEPTH`: past it a
 * tag is text, so a tree is shallow enough for a renderer to recurse over. A tag longer than
 * `MAX_TAG` characters is text, the next `]` is looked up once for many `[`, and a missing
 * `[/code]` or `[/img]` is looked up once and remembered, so no input makes it quadratic.
 */

import { videoOf, YOUTUBE_ID, type Video } from './video.ts';

export type BbNode =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'bold' | 'italic' | 'underline' | 'strike'; readonly children: readonly BbNode[] }
  | { readonly type: 'color'; readonly color: string; readonly children: readonly BbNode[] }
  | { readonly type: 'size'; readonly size: number; readonly children: readonly BbNode[] }
  | { readonly type: 'url'; readonly href: string; readonly children: readonly BbNode[] }
  | { readonly type: 'img'; readonly src: string }
  | { readonly type: 'video'; readonly video: Video }
  | { readonly type: 'quote'; readonly act: string; readonly children: readonly BbNode[] }
  | { readonly type: 'counterfeit'; readonly name: string | null; readonly user: string | null; readonly children: readonly BbNode[] }
  | { readonly type: 'spoiler'; readonly title: string; readonly children: readonly BbNode[] }
  | { readonly type: 'ispoiler'; readonly children: readonly BbNode[] }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'align'; readonly align: 'center' | 'left' | 'right'; readonly children: readonly BbNode[] }
  | { readonly type: 'hr' }
  | { readonly type: 'sub' | 'sup' | 'marquee' | 'rainbow'; readonly children: readonly BbNode[] }
  | { readonly type: 'font'; readonly font: string; readonly children: readonly BbNode[] }
  | { readonly type: 'glow' | 'shadow'; readonly color: string | null; readonly children: readonly BbNode[] }
  | { readonly type: 'highlight'; readonly color: string; readonly children: readonly BbNode[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly (readonly BbNode[])[] };

/** Longest typed name on a counterfeit quote, after trimming; a longer one makes the opener text. */
export const MAX_QUOTE_NAME = 80;

/** Longest title on a `[spoiler=title]`, after trimming; a longer one makes the opener text. */
export const MAX_SPOILER_TITLE = 80;
/** The title of a spoiler that was given none. */
export const DEFAULT_SPOILER_TITLE = 'Spoiler';

/** Deepest nesting of tags; past it a tag is text. Deep enough for quotes of quotes, shallow enough to render by recursion. */
export const MAX_DEPTH = 32;
/** Longest address accepted. */
export const MAX_URL_LENGTH = 2048;
/** Longest tag, brackets excluded; a longer one is text. Room for an address at its limit, with quotes and the tag name. */
export const MAX_TAG = MAX_URL_LENGTH + 16;
/**
 * `[size=n]` takes a whole number from 1 to 7, a fixed scale the renderer maps to its own
 * sizes. A free number would let a post hide its words at a pixel or fill the screen with one.
 */
export const MIN_SIZE = 1;
export const MAX_SIZE = 7;

/** CSS basic and extended color names that need no other syntax; anything else must be hex. */
export const NAMED_COLORS: ReadonlySet<string> = new Set([
  'black', 'silver', 'gray', 'grey', 'white', 'maroon', 'red', 'purple', 'fuchsia', 'green', 'lime',
  'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua', 'orange', 'pink', 'brown', 'gold', 'cyan',
  'magenta', 'violet', 'indigo', 'crimson', 'coral', 'salmon', 'turquoise', 'tan', 'khaki', 'beige',
]);

/**
 * The fonts `[font=name]` takes: each allowed name, lowercase, to the CSS stack the renderer sets. A name is
 * compared without case; the node holds the key, never the player's string, so no free text reaches a style.
 */
export const FONTS: Readonly<Record<string, string>> = {
  'verdana': 'Verdana, Geneva, sans-serif',
  'arial': 'Arial, Helvetica, sans-serif',
  'tahoma': 'Tahoma, Geneva, sans-serif',
  'trebuchet ms': '"Trebuchet MS", Helvetica, sans-serif',
  'georgia': 'Georgia, "Times New Roman", serif',
  'times new roman': '"Times New Roman", Times, serif',
  'courier new': '"Courier New", Courier, monospace',
  'comic sans ms': '"Comic Sans MS", "Comic Sans", cursive',
  'impact': 'Impact, Haettenschweiler, sans-serif',
};

/** The default color of a `[highlight]`. */
export const DEFAULT_HIGHLIGHT = 'yellow';

/** What each named color is, as #rrggbb, so a renderer can weigh a color's contrast. */
const NAMED_HEX: Readonly<Record<string, string>> = {
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff', maroon: '#800000',
  red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', green: '#008000', lime: '#00ff00', olive: '#808000',
  yellow: '#ffff00', navy: '#000080', blue: '#0000ff', teal: '#008080', aqua: '#00ffff', orange: '#ffa500',
  pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', cyan: '#00ffff', magenta: '#ff00ff', violet: '#ee82ee',
  indigo: '#4b0082', crimson: '#dc143c', coral: '#ff7f50', salmon: '#fa8072', turquoise: '#40e0d0', tan: '#d2b48c',
  khaki: '#f0e68c', beige: '#f5f5dc',
};

/** A `safeColor` value as #rrggbb (a name looked up, #rgb doubled), or null for anything else. */
export function colorHex(color: string): string | null {
  const v = color.toLowerCase();
  const named = NAMED_HEX[v];
  if (named) return named;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('');
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/* Whitespace, C0 and C1 controls, quotes, angle brackets, backticks, backslash, every format
   character (zero-width, direction, soft hyphen, annotation anchors), and the blank-looking
   fillers that are not formats (Hangul fillers, braille blank, combining grapheme joiner). */
const BAD_URL_CHAR = /[\s\u0000-\u001f\u007f-\u009f"'<>`\\\p{Cf}\u034f\u115f\u1160\u2800\u3164\uffa0\u2028\u2029]/u;
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

/* The authority of an http(s) address: no credentials, a real ASCII host (an international
   name arrives as punycode, `xn--`), and a port that is digits. `https://mfgg.net@evil.example/`
   is a link to evil.example, so any `@` here is a refusal. */
function goodAuthority(authority: string): boolean {
  const colon = authority.indexOf(':');
  const host = colon < 0 ? authority : authority.slice(0, colon);
  if (colon >= 0 && !/^[0-9]{1,5}$/.test(authority.slice(colon + 1))) return false;
  return HOST.test(host) && !host.includes('..');
}

function checkedUrl(raw: string, schemes: readonly string[], allowRelative: boolean): string | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > MAX_URL_LENGTH || BAD_URL_CHAR.test(s)) return null;
  const scheme = /^([^:/?#]*):/.exec(s);
  if (scheme) {
    /* The scheme is whatever precedes the first colon, so an entity or an odd spelling in it
       is simply not on the list. */
    const name = (scheme[1] ?? '').toLowerCase();
    if (!schemes.includes(name)) return null;
    const rest = s.slice(scheme[0].length);
    /* The scheme comes back lowercase; the rest is the player's. */
    const normalized = name + ':' + rest;
    if (name === 'mailto') return rest.length > 0 ? normalized : null;
    const authority = /^\/\/([^/?#]*)/.exec(rest);
    return authority && goodAuthority(authority[1] ?? '') ? normalized : null;
  }
  if (allowRelative && s.startsWith('/') && !s.startsWith('//')) return s;
  return null;
}

/**
 * A color, lowercased, or null: a named one from NAMED_COLORS, or #rgb or #rrggbb. The one check
 * for a color anywhere in the engine, so a post's [color] and a card's ink read the same list.
 */
export function safeColor(raw: string): string | null {
  const v = raw.toLowerCase();
  return NAMED_COLORS.has(v) || HEX_COLOR.test(v) ? v : null;
}

/** The address of a link, or null: http, https, mailto, or a path on this site. */
export function safeHref(raw: string): string | null {
  return checkedUrl(raw, ['http', 'https', 'mailto'], true);
}

/** The source of an image, or null: http or https only. */
export function safeImageSrc(raw: string): string | null {
  return checkedUrl(raw, ['http', 'https'], false);
}

type Out = BbNode[];

interface Frame {
  readonly kind: 'root' | 'simple' | 'list' | 'bareurl' | 'literal';
  /** Lowercase tag name, which a closer matches. */
  readonly name: string;
  /** The opening tag as written. */
  readonly raw: string;
  /** Nearest frame that is not literal, at or below this one (itself when it is not literal). */
  home: Frame;
  /** For a frame that is not literal, the home of the frame under it. */
  readonly parent: Frame | null;
  readonly depth: number;
  /** Where this frame's content goes now. */
  out: Out;
  build?: (children: Out) => BbNode;
  ordered?: boolean;
  items?: Out[];
  lead?: Out;
}

const SIMPLE: Readonly<Record<string, 'bold' | 'italic' | 'underline' | 'strike'>> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  s: 'strike',
};
/** The tags the parser knows how to open, for a rule that names one (engine/rules/predicates.ts `noTag`). */
export const BBCODE_TAGS: readonly string[] = ['b', 'i', 'u', 's', 'color', 'size', 'url', 'img', 'code', 'quote', 'list', 'spoiler', 'ispoiler', 'video', 'youtube', 'align', 'hr', 'sub', 'sup', 'font', 'marquee', 'glow', 'shadow', 'rainbow', 'highlight', 'noparse'];
const OPENERS: ReadonlySet<string> = new Set(BBCODE_TAGS);
const CLOSERS = new Set(['b', 'i', 'u', 's', 'color', 'size', 'url', 'quote', 'list', 'spoiler', 'ispoiler', 'video', 'youtube', 'align', 'sub', 'sup', 'font', 'marquee', 'glow', 'shadow', 'rainbow', 'highlight']);
/**
 * The block tags, the ones that cannot stand inside inline text. An `[ispoiler]` holds inline formatting
 * only, so while one is open the opener and the closer of each of these is text. Tags added later that
 * are blocks go in this one set.
 */
const BLOCK: ReadonlySet<string> = new Set([
  'quote', 'code', 'list', 'spoiler', 'align', 'center', 'left', 'right', 'hr', 'video', 'youtube', 'marquee',
]);

function pushText(out: Out, text: string): void {
  if (text.length === 0) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') out[out.length - 1] = { type: 'text', text: last.text + text };
  else out.push({ type: 'text', text });
}

function pushNode(out: Out, node: BbNode): void {
  if (node.type === 'text') pushText(out, node.text);
  else out.push(node);
}

function unquote(v: string): string {
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

type QuoteHead =
  | { readonly kind: 'real'; readonly act: string }
  | { readonly kind: 'counterfeit'; readonly name: string | null; readonly user: string | null };

/**
 * What follows `quote` in a quote opener: nothing, `=<name>`, ` user=<id>` or `=<name> user=<id>`,
 * the name quoted or the words up to whitespace and `user=` (in any case). A name that is an Act id is a real quote (`user=`
 * dropped, since the author of a real quote always comes from the post); any other name of 1 to
 * `MAX_QUOTE_NAME` characters is a counterfeit. Null when it is none of these, and the opener is text.
 */
function quoteHead(rest: string): QuoteHead | null {
  let name: string | null = null;
  let tail: string;
  if (rest.startsWith('=')) {
    const v = rest.slice(1);
    if (v.startsWith('"')) {
      const j = v.indexOf('"', 1);
      if (j < 0) return null;
      name = v.slice(1, j);
      tail = v.slice(j + 1);
    } else {
      /* `user=` after any run of whitespace, in any case, as the tail's own test reads it, so it is never swallowed into the name. */
      const at = v.search(/\suser=/i);
      name = at < 0 ? v : v.slice(0, at);
      tail = at < 0 ? '' : v.slice(at);
    }
    name = name.trim();
    if (name.length === 0 || name.length > MAX_QUOTE_NAME) return null;
  } else {
    tail = rest;
  }
  let user: string | null = null;
  if (tail !== '') {
    const m = /^\s+user=(.*)$/i.exec(tail);
    if (!m || !UUID.test(m[1] ?? '')) return null;
    user = (m[1] as string).toLowerCase();
  }
  if (name !== null && UUID.test(name)) return { kind: 'real', act: name.toLowerCase() };
  return { kind: 'counterfeit', name, user };
}

function isBlank(nodes: readonly BbNode[]): boolean {
  return nodes.every((n) => n.type === 'text' && n.text.trim() === '');
}

export function parse(input: string): BbNode[] {
  const root: Frame = { kind: 'root', name: '', raw: '', home: null as never, parent: null, depth: 0, out: [] };
  root.home = root;
  const stack: Frame[] = [root];
  /** How many frames (literal included) are open per tag name, so a stray closer is found without a scan. */
  const open = new Map<string, number>();
  const top = (): Frame => stack[stack.length - 1] ?? root;

  /* Finish a frame that is not literal and place its node in its parent. `closer` is the
     closing tag as written, or null when the frame was closed by the end of input or by an
     outer closer. */
  const finish = (f: Frame, closer: string | null): void => {
    const into = (f.parent ?? root).out;
    if (f.kind === 'simple' && f.build) {
      into.push(f.build(f.out));
    } else if (f.kind === 'list') {
      const items = f.items ?? [];
      if (f.lead && !isBlank(f.lead)) items.unshift(f.lead);
      into.push({ type: 'list', ordered: f.ordered === true, items });
    } else if (f.kind === 'bareurl') {
      const only = f.out.length === 1 ? f.out[0] : undefined;
      const href = closer !== null && only && only.type === 'text' ? safeHref(only.text) : null;
      if (href !== null && only) {
        into.push({ type: 'url', href, children: [only] });
      } else {
        pushText(into, f.raw);
        for (const n of f.out) pushNode(into, n);
        if (closer !== null) pushText(into, closer);
      }
    }
  };

  /** Links that are open and real, which is what a new link must not nest inside. */
  let openUrls = 0;
  /** Inline spoilers that are open and real, so a block tag inside one is found without a scan. */
  let openISpoilers = 0;

  const pop = (): Frame => {
    const f = stack.pop() as Frame;
    open.set(f.name, (open.get(f.name) ?? 1) - 1);
    if (f.kind !== 'literal' && f.name === 'url') openUrls--;
    if (f.kind !== 'literal' && f.name === 'ispoiler') openISpoilers--;
    return f;
  };

  const push = (f: Frame): void => {
    stack.push(f);
    open.set(f.name, (open.get(f.name) ?? 0) + 1);
  };

  /** An opener that is text, remembered so its closer is text too. */
  const literalOpen = (name: string, raw: string): void => {
    const home = top().home;
    pushText(home.out, raw);
    push({ kind: 'literal', name, raw, home, parent: null, depth: home.depth, out: home.out });
  };

  const openReal = (name: string, raw: string, kind: Frame['kind'], extra: Partial<Frame>): void => {
    const home = top().home;
    if (home.depth >= MAX_DEPTH) {
      literalOpen(name, raw);
      return;
    }
    const f: Frame = { kind, name, raw, home: null as never, parent: home, depth: home.depth + 1, out: [], ...extra };
    f.home = f;
    push(f);
    if (name === 'url') openUrls++;
    if (name === 'ispoiler') openISpoilers++;
  };

  /* A new link while a real one is open closes the open one first (with whatever was opened
     inside it and never closed), so no link nests in another. That turns the fewest words and
     tags into text: a forgotten closer costs nothing, and a properly nested pair costs only the
     outer link's stray closer. */
  const closeOpenLink = (): void => {
    while (openUrls > 0) {
      const f = pop();
      if (f.kind !== 'literal') finish(f, null);
    }
  };

  const closeTag = (name: string, raw: string): void => {
    if ((open.get(name) ?? 0) === 0) {
      pushText(top().home.out, raw);
      return;
    }
    for (;;) {
      const f = pop();
      if (f.name === name) {
        if (f.kind === 'literal') pushText(top().home.out, raw);
        else finish(f, raw);
        return;
      }
      if (f.kind !== 'literal') finish(f, null);
    }
  };

  let nextClose = -2;
  const closeFrom = (i: number): number => {
    if (nextClose === -1) return -1;
    if (nextClose > i) return nextClose;
    nextClose = input.indexOf(']', i + 1);
    return nextClose;
  };

  const rawEnds: Record<string, { re: RegExp; missing: boolean; at: number }> = {
    code: { re: /\[\/code\]/gi, missing: false, at: -1 },
    img: { re: /\[\/img\]/gi, missing: false, at: -1 },
    video: { re: /\[\/video\]/gi, missing: false, at: -1 },
    youtube: { re: /\[\/youtube\]/gi, missing: false, at: -1 },
    noparse: { re: /\[\/noparse\]/gi, missing: false, at: -1 },
  };

  let pos = 0;
  let textStart = 0;
  for (;;) {
    const i = input.indexOf('[', pos);
    if (i === -1) break;
    const close = closeFrom(i);
    if (close === -1) break;
    pos = i + 1;
    if (close - i - 1 > MAX_TAG || close === i + 1) continue;
    const body = input.slice(i + 1, close);
    if (body.includes('[')) continue;
    const raw = input.slice(i, close + 1);

    /* Work out what the tag is before touching the text in front of it. */
    let name: string;
    let value: string | undefined;
    let isCloser = false;
    let quoteRest: string | undefined;
    if (body === '*') {
      name = '*';
    } else if (body.startsWith('/')) {
      name = body.slice(1).toLowerCase();
      if (!CLOSERS.has(name)) continue;
      isCloser = true;
    } else if (/^quote(?=$|=|\s)/i.test(body)) {
      name = 'quote';
      quoteRest = body.slice(5);
    } else {
      const eq = body.indexOf('=');
      name = (eq < 0 ? body : body.slice(0, eq)).toLowerCase();
      if (!OPENERS.has(name)) continue;
      if (eq >= 0) value = unquote(body.slice(eq + 1));
    }

    pushText(top().home.out, input.slice(textStart, i));
    textStart = close + 1;
    pos = close + 1;

    if (openISpoilers > 0 && name !== '*' && (BLOCK.has(name) || name === 'url' || (name === 'ispoiler' && !isCloser))) {
      /* Opener or closer, a block tag, a link or a nested spoiler inside an inline spoiler is the words as written
         (the spoiler is a button, and a button holds nothing interactive). */
      pushText(top().home.out, raw);
    } else if (isCloser) {
      closeTag(name, raw);
    } else if (name === '*') {
      const home = top().home;
      if (home.kind === 'list') {
        const item: Out = [];
        (home.items ??= []).push(item);
        home.out = item;
      } else {
        pushText(home.out, raw);
      }
    } else if (name === 'code' || name === 'img' || name === 'video' || name === 'youtube' || name === 'noparse') {
      const end = rawEnds[name] as { re: RegExp; missing: boolean; at: number };
      const home = top().home;
      let found = -1;
      if (value === undefined && !end.missing) {
        /* The first closer after a point stays the first closer for every later opener up to
           it, so it is looked up again only once the parser has passed it. */
        if (end.at < close + 1) {
          end.re.lastIndex = close + 1;
          const m = end.re.exec(input);
          if (m) end.at = m.index;
          else end.missing = true;
        }
        if (!end.missing) found = end.at;
      }
      if (found < 0) {
        pushText(home.out, raw);
      } else if (name === 'code') {
        home.out.push({ type: 'code', text: input.slice(close + 1, found) });
        textStart = pos = found + '[/code]'.length;
      } else if (name === 'noparse') {
        /* Its contents are the post's words as written: one text node, which the tree and the visible text treat as any other. */
        pushText(home.out, input.slice(close + 1, found));
        textStart = pos = found + '[/noparse]'.length;
      } else if (name === 'video' || name === 'youtube') {
        /* Same bound on work as an image. A video is whatever `videoOf` recognizes; [youtube] also takes a bare id. */
        const inner = found - close - 1 <= MAX_URL_LENGTH + 64 ? input.slice(close + 1, found).trim() : '';
        const video = inner === '' ? null : name === 'youtube' && YOUTUBE_ID.test(inner) ? videoOf(`https://youtu.be/${inner}`) : videoOf(inner);
        if (video) {
          home.out.push({ type: 'video', video });
          textStart = pos = found + name.length + 3;
        } else pushText(home.out, raw);
      } else if (
        /* A bound on work, not on meaning, so no test can see it: contents this much longer than
           the longest address cannot be one (surrounding blanks are trimmed), and checking them
           would rescan the same long stretch for every opener in front of one closer. */
        found - close - 1 <= MAX_URL_LENGTH + 64 && safeImageSrc(input.slice(close + 1, found)) !== null
      ) {
        home.out.push({ type: 'img', src: safeImageSrc(input.slice(close + 1, found)) as string });
        textStart = pos = found + '[/img]'.length;
      } else {
        /* Only the opener is text; what follows is parsed as usual, so a bad image cannot
           swallow the words and tags between it and some later closer. */
        pushText(home.out, raw);
      }
    } else if (name in SIMPLE) {
      const type = SIMPLE[name] as 'bold' | 'italic' | 'underline' | 'strike';
      if (value === undefined) openReal(name, raw, 'simple', { build: (children) => ({ type, children }) });
      else literalOpen(name, raw);
    } else if (name === 'color') {
      const v = value === undefined ? null : safeColor(value);
      if (v !== null) {
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'color', color: v, children }) });
      } else literalOpen(name, raw);
    } else if (name === 'size') {
      const n = value !== undefined && /^[1-7]$/.test(value) ? Number(value) : null;
      if (n !== null && n >= MIN_SIZE && n <= MAX_SIZE) {
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'size', size: n, children }) });
      } else literalOpen(name, raw);
    } else if (name === 'url') {
      if (value === undefined) {
        closeOpenLink();
        openReal(name, raw, 'bareurl', {});
      } else {
        const href = safeHref(value);
        if (href !== null) {
          closeOpenLink();
          openReal(name, raw, 'simple', { build: (children) => ({ type: 'url', href, children }) });
        } else literalOpen(name, raw);
      }
    } else if (name === 'quote') {
      const head = quoteHead(quoteRest ?? '');
      if (head === null) literalOpen(name, raw);
      else if (head.kind === 'real') {
        const act = head.act;
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'quote', act, children }) });
      } else {
        const { name: typed, user } = head;
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'counterfeit', name: typed, user, children }) });
      }
    } else if (name === 'spoiler') {
      const title = value === undefined ? '' : value.trim();
      if (title.length > MAX_SPOILER_TITLE) literalOpen(name, raw);
      else {
        const shown = title === '' ? DEFAULT_SPOILER_TITLE : title;
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'spoiler', title: shown, children }) });
      }
    } else if (name === 'ispoiler') {
      if (value === undefined) openReal(name, raw, 'simple', { build: (children) => ({ type: 'ispoiler', children }) });
      else literalOpen(name, raw);
    } else if (name === 'align') {
      const a = value === undefined ? '' : value.toLowerCase();
      if (a === 'center' || a === 'left' || a === 'right') {
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'align', align: a, children }) });
      } else literalOpen(name, raw);
    } else if (name === 'hr') {
      /* No closer: it is a rule, whole. A `[/hr]` is not in CLOSERS, so it stays text. */
      if (value === undefined) top().home.out.push({ type: 'hr' });
      else pushText(top().home.out, raw);
    } else if (name === 'sub' || name === 'sup' || name === 'marquee' || name === 'rainbow') {
      if (value === undefined) openReal(name, raw, 'simple', { build: (children) => ({ type: name, children }) });
      else literalOpen(name, raw);
    } else if (name === 'font') {
      const key = value === undefined ? '' : value.trim().toLowerCase();
      if (Object.hasOwn(FONTS, key)) openReal(name, raw, 'simple', { build: (children) => ({ type: 'font', font: key, children }) });
      else literalOpen(name, raw);
    } else if (name === 'glow' || name === 'shadow' || name === 'highlight') {
      const c = value === undefined ? null : safeColor(value);
      if (value !== undefined && c === null) literalOpen(name, raw);
      else if (name === 'highlight') {
        const color = c ?? DEFAULT_HIGHLIGHT;
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'highlight', color, children }) });
      } else {
        openReal(name, raw, 'simple', { build: (children) => ({ type: name, color: c, children }) });
      }
    } else if (name === 'list') {
      if (value === undefined || value === '1') {
        const lead: Out = [];
        openReal(name, raw, 'list', { ordered: value === '1', items: [], lead, out: lead });
      } else literalOpen(name, raw);
    }
  }

  pushText(top().home.out, input.slice(textStart));
  while (stack.length > 1) {
    const f = pop();
    if (f.kind !== 'literal') finish(f, null);
  }
  return root.out;
}
