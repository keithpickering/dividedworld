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
 * - `[code]` and `[img]` take their contents raw up to the closing tag. With no closing tag,
 *   an attribute, or (for an image) contents that are not an http or https address, only the
 *   opening tag is text, and what follows parses as usual.
 * - A link inside a link is text, with its closer, since a nested anchor is not valid markup.
 *   An image inside a link is fine: it is a node of its own with a checked source.
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

export type BbNode =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'bold' | 'italic' | 'underline' | 'strike'; readonly children: readonly BbNode[] }
  | { readonly type: 'color'; readonly color: string; readonly children: readonly BbNode[] }
  | { readonly type: 'size'; readonly size: number; readonly children: readonly BbNode[] }
  | { readonly type: 'url'; readonly href: string; readonly children: readonly BbNode[] }
  | { readonly type: 'img'; readonly src: string }
  | { readonly type: 'quote'; readonly act: string; readonly children: readonly BbNode[] }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly (readonly BbNode[])[] };

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
const OPENERS = new Set(['b', 'i', 'u', 's', 'color', 'size', 'url', 'img', 'code', 'quote', 'list']);
const CLOSERS = new Set(['b', 'i', 'u', 's', 'color', 'size', 'url', 'quote', 'list']);

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

  const pop = (): Frame => {
    const f = stack.pop() as Frame;
    open.set(f.name, (open.get(f.name) ?? 1) - 1);
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
    if (body === '*') {
      name = '*';
    } else if (body.startsWith('/')) {
      name = body.slice(1).toLowerCase();
      if (!CLOSERS.has(name)) continue;
      isCloser = true;
    } else {
      const eq = body.indexOf('=');
      name = (eq < 0 ? body : body.slice(0, eq)).toLowerCase();
      if (!OPENERS.has(name)) continue;
      if (eq >= 0) value = unquote(body.slice(eq + 1));
    }

    pushText(top().home.out, input.slice(textStart, i));
    textStart = close + 1;
    pos = close + 1;

    if (isCloser) {
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
    } else if (name === 'code' || name === 'img') {
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
      } else if (found - close - 1 <= MAX_URL_LENGTH + 64 && safeImageSrc(input.slice(close + 1, found)) !== null) {
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
      const v = value?.toLowerCase();
      if (v !== undefined && (NAMED_COLORS.has(v) || HEX_COLOR.test(v))) {
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'color', color: v, children }) });
      } else literalOpen(name, raw);
    } else if (name === 'size') {
      const n = value !== undefined && /^[1-7]$/.test(value) ? Number(value) : null;
      if (n !== null && n >= MIN_SIZE && n <= MAX_SIZE) {
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'size', size: n, children }) });
      } else literalOpen(name, raw);
    } else if (name === 'url') {
      if ((open.get('url') ?? 0) > 0) {
        literalOpen(name, raw);
      } else if (value === undefined) {
        openReal(name, raw, 'bareurl', {});
      } else {
        const href = (open.get('url') ?? 0) === 0 ? safeHref(value) : null;
        if (href !== null) openReal(name, raw, 'simple', { build: (children) => ({ type: 'url', href, children }) });
        else literalOpen(name, raw);
      }
    } else if (name === 'quote') {
      if (value !== undefined && UUID.test(value)) {
        const act = value.toLowerCase();
        openReal(name, raw, 'simple', { build: (children) => ({ type: 'quote', act, children }) });
      } else literalOpen(name, raw);
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
