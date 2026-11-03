/**
 * The Strategy Guide's Markdown (docs/plans/2026-11-02-onboarding-design.md, section 8; the plan's Task 8): a small reader for the prose an
 * instance writes, trusted in who writes it (it is committed and reviewed, never typed by a player) and still never given the power of
 * markup. It reads headings, paragraphs, bold, italic, code, lists, tables, links and block quotes, and returns a tree; the screen draws
 * the tree as React elements (engine/ui/guide/render.tsx), so nothing here ever becomes HTML. A `<tag>`, a `<script>` or an entity is
 * text and is shown as the characters it is. A link goes to http, https, a path of this site or a fragment, and any other address
 * (`javascript:`, `data:`, a protocol-relative `//`) leaves only the link's words.
 *
 * Two things in the prose are not Markdown, and both are how the guide stays true to the instance it describes:
 *
 * - A marker, `<!-- kayfabb:<name> -->` alone on a line, is a block the screen fills from the live instance: the welcome letter, the
 *   reaction grid, each class with its own marks, the cards with their prices (MARKERS). The tree names it and the screen fills it.
 * - `{{setting:<path>}}`, inline, is one number from the live settings. A path is a setting's name (`walletCap`), or a name in one of
 *   the settings' maps (`cardEconomy.whoops.price`: the map's name, then the key it holds, dots and all). It is said as the HUD says
 *   it: the wallet and a card's price are Aura (hundredths of an orb as two decimals, `figure`), a span is words ("30 days",
 *   `spanWords`), and any other number is the number. `settingText` is the one reading, used by the page and by tools/check-guide.mjs,
 *   so a path the check accepts is a path the page can say.
 *
 * Any other `<!-- comment -->`, on one line or many, is the author's note and is dropped; one that never closes is text, so a stray
 * `<!--` cannot swallow the rest of the guide.
 */
import { figure, spanWords } from '../characters/format.ts';
import type { ScreenSettings } from '../data/api.ts';

export type Inline =
  | { readonly t: 'text'; readonly text: string }
  | { readonly t: 'strong' | 'em'; readonly children: readonly Inline[] }
  | { readonly t: 'code'; readonly text: string }
  | { readonly t: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly t: 'setting'; readonly path: string };

export type Block =
  | { readonly t: 'heading'; readonly level: 1 | 2 | 3 | 4; readonly children: readonly Inline[] }
  | { readonly t: 'p'; readonly children: readonly Inline[] }
  | { readonly t: 'ul' | 'ol'; readonly items: readonly (readonly Inline[])[] }
  | { readonly t: 'quote'; readonly blocks: readonly Block[] }
  | { readonly t: 'table'; readonly head: readonly (readonly Inline[])[]; readonly rows: readonly (readonly (readonly Inline[])[])[] }
  | { readonly t: 'hr' }
  | { readonly t: 'marker'; readonly name: string };

/** The markers the engine fills (tools/check-guide.mjs refuses any other name). */
export const MARKERS = ['letter', 'reactions', 'classes', 'cards'] as const;
export type MarkerName = (typeof MARKERS)[number];

/* ------------------------------------------------------------------------ links ---- */

/** http, https, a path of this site (one slash, not two, and no backslash, which a browser reads as a slash) or a fragment: no scheme that runs code, no `//host`. */
const SAFE_HREF = /^(?:https?:\/\/[^\s]+|\/(?![\/\\])[^\s]*|#[^\s]*)$/iu;
export const safeHref = (href: string): boolean => SAFE_HREF.test(href);

/* ----------------------------------------------------------------------- inline ---- */

const ESCAPABLE = '\\`*_{}[]()#+-.!|<>';
const SETTING = /^[A-Za-z][\w.-]*$/u;
const alnum = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** The index of the single `*` that closes an emphasis opened before `from`, or -1. */
function closingStar(src: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '*' && src[j + 1] !== '*' && src[j - 1] !== '*') return j;
  }
  return -1;
}

/** The index of the `_` that closes an underscore emphasis (followed by no letter or digit), or -1. */
function closingUnderscore(src: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '_' && !alnum(src[j + 1])) return j;
  }
  return -1;
}

/** The index of the `)` that closes a link's address opened before `from`, counting the address's own pairs; -1 if it never closes. */
function closingParen(src: string, from: number): number {
  let depth = 1;
  for (let j = from; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')' && --depth === 0) return j;
  }
  return -1;
}

function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf !== '') { out.push({ t: 'text', text: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1]!)) { buf += src[i + 1]; i += 2; continue; }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'code', text: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (c === '{' && src.startsWith('{{setting:', i)) {
      const end = src.indexOf('}}', i);
      const path = end < 0 ? '' : src.slice(i + '{{setting:'.length, end).trim();
      if (SETTING.test(path)) { flush(); out.push({ t: 'setting', path }); i = end + 2; continue; }
    }
    if (c === '*' && src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) { flush(); out.push({ t: 'strong', children: inline(src.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    if (c === '*' && src[i + 1] !== '*' && src[i + 1] !== ' ') {
      const end = closingStar(src, i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'em', children: inline(src.slice(i + 1, end)) }); i = end + 1; continue; }
    }
    if (c === '_' && !alnum(src[i - 1]) && src[i + 1] !== '_' && src[i + 1] !== ' ') {
      const end = closingUnderscore(src, i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'em', children: inline(src.slice(i + 1, end)) }); i = end + 1; continue; }
    }
    if (c === '[') {
      const close = src.indexOf('](', i + 1);
      const end = close < 0 ? -1 : closingParen(src, close + 2);
      if (close > i + 1 && end > close + 2) {
        const href = src.slice(close + 2, end).trim();
        const words = inline(src.slice(i + 1, close));
        flush();
        if (safeHref(href)) out.push({ t: 'link', href, children: words });
        else out.push(...words);
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** The words of some inline nodes, a setting said by `say`: for a heading's title and an anchor. */
export function inlineText(nodes: readonly Inline[], say: (path: string) => string = (path) => `{{setting:${path}}}`): string {
  return nodes.map((n) => {
    if (n.t === 'text' || n.t === 'code') return n.text;
    if (n.t === 'setting') return say(n.path);
    return inlineText(n.children, say);
  }).join('');
}

/** An anchor for a heading: lowercase words joined by hyphens. */
export function slug(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
}

export interface Section {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly Block[];
}

/**
 * The guide's sections: each second-level heading and what follows it, with an anchor made from its words, kept unique. The one reading,
 * used by the page (its sections and their ids) and by tools/check-guide.mjs (a `#fragment` link must name one of these).
 */
export function sectionsOf(blocks: readonly Block[], say: (path: string) => string): Section[] {
  const out: { id: string; title: string; blocks: Block[] }[] = [];
  const used = new Set<string>();
  for (const b of blocks) {
    if (b.t === 'heading' && b.level === 2) {
      const title = inlineText(b.children, say);
      const base = slug(title) || 'section';
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      used.add(id);
      out.push({ id, title, blocks: [] });
    } else if (out.length > 0) out.at(-1)!.blocks.push(b);
  }
  return out;
}

/* ----------------------------------------------------------------------- blocks ---- */

const MARKER_LINE = /^<!--\s*kayfabb:([A-Za-z][\w-]*)\s*-->$/u;
const HEADING = /^(#{1,4})\s+(.+?)(?:\s+#+)?\s*$/u;
const RULE = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u;
const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u;

const cells = (line: string): string[] => {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/u).map((c) => c.trim().replace(/\\\|/gu, '|'));
};

const startsTable = (lines: readonly string[], i: number): boolean => lines[i]!.includes('|') && i + 1 < lines.length && lines[i + 1]!.includes('-') && SEPARATOR.test(lines[i + 1]!);

/** Whether a line begins a block of its own, which ends the paragraph above it. */
function startsBlock(lines: readonly string[], i: number): boolean {
  const t = lines[i]!.trim();
  return t.startsWith('<!--') || HEADING.test(t) || RULE.test(t) || ITEM.test(lines[i]!) || t.startsWith('>') || startsTable(lines, i);
}

function blocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (t === '') { i++; continue; }

    if (t.startsWith('<!--')) {
      const marker = MARKER_LINE.exec(t);
      if (marker) { out.push({ t: 'marker', name: marker[1]! }); i++; continue; }
      let j = i;
      while (j < lines.length && !lines[j]!.includes('-->')) j++;
      if (j < lines.length) { i = j + 1; continue; }
      /* Never closed: it is text, and the guide below it is still there. */
    } else {
      const heading = HEADING.exec(t);
      if (heading) { out.push({ t: 'heading', level: heading[1]!.length as 1 | 2 | 3 | 4, children: inline(heading[2]!) }); i++; continue; }
      if (RULE.test(t)) { out.push({ t: 'hr' }); i++; continue; }
      if (t.startsWith('>')) {
        const quoted: string[] = [];
        while (i < lines.length && lines[i]!.trim().startsWith('>')) { quoted.push(lines[i]!.trim().replace(/^>\s?/u, '')); i++; }
        out.push({ t: 'quote', blocks: blocks(quoted) });
        continue;
      }
      if (startsTable(lines, i)) {
        const head = cells(line).map(inline);
        i += 2;
        const rows: Inline[][][] = [];
        /* Every row is as wide as the header: a short one is padded with empty cells, a long one cut, so the screen draws a table. */
        while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
          const row = cells(lines[i]!).slice(0, head.length);
          while (row.length < head.length) row.push('');
          rows.push(row.map(inline));
          i++;
        }
        out.push({ t: 'table', head, rows });
        continue;
      }
      const item = ITEM.exec(line);
      if (item) {
        const ordered = /\d/u.test(item[2]!);
        const items: string[] = [];
        while (i < lines.length) {
          const m = ITEM.exec(lines[i]!);
          if (m && /\d/u.test(m[2]!) === ordered) { items.push(m[3]!.trim()); i++; continue; }
          if (lines[i]!.trim() === '') {
            let k = i;
            while (k < lines.length && lines[k]!.trim() === '') k++;
            const next = k < lines.length ? ITEM.exec(lines[k]!) : null;
            if (next && /\d/u.test(next[2]!) === ordered) { i = k; continue; }
            break;
          }
          if (/^\s{2,}\S/u.test(lines[i]!) && !m) { items[items.length - 1] += ` ${lines[i]!.trim()}`; i++; continue; }
          break;
        }
        out.push({ t: ordered ? 'ol' : 'ul', items: items.map(inline) });
        continue;
      }
    }

    const para: string[] = [t];
    i++;
    while (i < lines.length && lines[i]!.trim() !== '' && !startsBlock(lines, i)) { para.push(lines[i]!.trim()); i++; }
    out.push({ t: 'p', children: inline(para.join(' ')) });
  }
  return out;
}

/** The tree of a guide's Markdown. */
export function parse(md: string): Block[] {
  return blocks(md.replace(/\r\n?/gu, '\n').split('\n'));
}

/* --------------------------------------------------------------------- settings ---- */

type Kind = 'aura' | 'count' | 'span' | 'map';

/**
 * How each screen setting may be said. The record is typed by `ScreenSettings`' own keys, so a setting added there is a line to
 * decide here (null: not a number or a span, not for prose), and a path the guide names can never be one the page cannot say.
 */
const KINDS: { readonly [K in keyof ScreenSettings]-?: Kind | null } = {
  postsPerPage: 'count', hotReplies: 'count', editGrace: 'span', reactionCap: 'count', charactersPerPlayer: 'count', invitesPerPlayer: 'count',
  inviteLifetime: 'span', turnCooldown: 'span', walletCap: 'aura', postMaxLength: 'count', titleMaxLength: 'count', registrationMode: null,
  settlementLength: 'span', presencePollSeconds: 'count', presenceWindow: 'span', cardSettings: 'map', cardEconomy: 'map', economy: 'map', toastDefaults: null, toastMs: 'count',
};

const isSpan = (v: unknown): v is { readonly unit: string; readonly count: number } =>
  typeof v === 'object' && v !== null && typeof (v as { unit?: unknown }).unit === 'string' && Number.isFinite((v as { count?: unknown }).count);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One setting said for a player, or undefined when the path names nothing sayable. Aura (the wallet's cap, and any card economy number
 * named `….price`) is two decimals of an orb, as the HUD says it; a span is "30 days"; any other number is itself.
 */
export function settingText(path: string, settings: ScreenSettings): string | undefined {
  const dot = path.indexOf('.');
  const head = dot < 0 ? path : path.slice(0, dot);
  const rest = dot < 0 ? '' : path.slice(dot + 1);
  if (!Object.hasOwn(KINDS, head)) return undefined;
  const kind = KINDS[head as keyof ScreenSettings];
  const value = (settings as unknown as Record<string, unknown>)[head];
  if (kind === 'map') {
    if (rest === '' || typeof value !== 'object' || value === null || !Object.hasOwn(value, rest)) return undefined;
    const n = (value as Record<string, unknown>)[rest];
    if (!finite(n)) return undefined;
    return head === 'cardEconomy' && rest.endsWith('.price') ? figure(n) : String(n);
  }
  if (rest !== '' || kind === null) return undefined;
  if (kind === 'span') return isSpan(value) ? spanWords(value as Parameters<typeof spanWords>[0]) : undefined;
  if (!finite(value)) return undefined;
  return kind === 'aura' ? figure(value) : String(value);
}
