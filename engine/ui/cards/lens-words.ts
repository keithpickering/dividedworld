/**
 * The checks on the Lens's words (backfill-boards design, section 6): what each block of a card's words is for, held to what
 * can be checked from the words alone. The heading (`CardView.state`, or `CardUi.status` for a card with no live view) is a
 * short status, never a sentence; a view that holds the reader or covers the post has an `ends`, its way out (CLAUDE.md, "No
 * player is ever stuck"). Pure: `instanceUiProblems` runs `wordsProblems` over every card's status, and each effect's own
 * tests run `viewProblems` over the views it can show.
 */
import type { Id, KayfaApi } from '../data/api.ts';
import type { CardView } from './types.ts';

/** The most words a state or status may run: a heading, not a description. */
export const STATUS_MAX_WORDS = 6;

/** What a view does to the reader: holds their screen (`EffectProps.holdScreen`), or covers the post (`CardUi.takeover`). */
export interface ViewKind {
  readonly holds: boolean;
  readonly covers: boolean;
}

/** The words counted: a run with a letter or a digit in it, so a separating "·" is no word. */
const wordCount = (words: string): number => words.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Whether the words hold a sentence: a stop followed by more words, or a colon. */
const isSentence = (words: string): boolean => /[.!?]\s+\S/u.test(words.trim()) || words.includes(':');

/** A state or status held to the roles; each problem names the predicate that failed. */
export function wordsProblems(what: 'state' | 'status', words: string): string[] {
  if (words.trim() === '') return [`the ${what} is empty`];
  const out: string[] = [];
  if (isSentence(words)) out.push(`the ${what} "${words}" is a sentence (a stop followed by more words, or a colon), and a ${what} is a short status`);
  const n = wordCount(words);
  if (n > STATUS_MAX_WORDS) out.push(`the ${what} "${words}" is ${n} words, over the ${STATUS_MAX_WORDS} a ${what} may run`);
  return out;
}

/** A view held to the roles: its state, and an `ends` whenever it holds the reader or covers the post. */
export function viewProblems(view: CardView, kind: ViewKind): string[] {
  const out = wordsProblems('state', view.state);
  const needs = kind.holds ? 'holds the reader' : kind.covers ? 'covers the post' : null;
  if (needs !== null && (view.ends === undefined || view.ends.trim() === '')) out.push(`the view "${view.state}" ${needs} and has no ends, its way out`);
  return out;
}

/** What the Lens says of a card that landed from a back: who set it, when, and what set it off (`sprungWords`). Every part is a public fact of the spring. */
export interface SprungFacts {
  /** The setter's character, as the spring names it; null where it could not be read. */
  readonly setter: string | null;
  /** When the back was set (an ISO time); null where the set could not be read. */
  readonly setAt: string | null;
  /** The character whose post quoted it, for a spring that a quote or a reply set off; null where it could not be read. */
  readonly quoter: string | null;
  /** What set it off: the spring's trigger (`quote`, or one written before the face-down Moves: `reply`, `reaction`). */
  readonly trigger: string | null;
  /** The passage the quoted excerpt held, where the back set one and it matched (the spring's `when.passage`); shown in full. */
  readonly passage?: string | null;
  /** The phrase the quoting post said, where the back set one and it matched (the spring's `when.says`); shown in full. */
  readonly says?: string | null;
}

/** The longest a condition runs in an alert, a toast or a log line; the Lens shows it whole. */
export const QUOTE_SHORT = 40;

/**
 * The text in quotation marks, cut at the last word boundary within `most` characters, with "…" inside the marks when it was cut. `Infinity` keeps it whole.
 * The marks are the curly pair the rest of the game's copy uses for a phrase.
 */
export function shortQuote(text: string, most: number = QUOTE_SHORT): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= most) return `\u201c${flat}\u201d`;
  const cut = flat.slice(0, most);
  const atBoundary = flat[most] === ' ';
  const at = cut.lastIndexOf(' ');
  const head = (atBoundary || at <= 0 ? cut : cut.slice(0, at)).trimEnd();
  return `\u201c${head}\u2026\u201d`;
}

const textOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The conditions a spring Act matched (its payload's `when`; never an Anyone-but list), each text unquoted and unshortened. Absent ones are null. */
export function springConditions(payload: Readonly<Record<string, unknown>>): { readonly says: string | null; readonly passage: string | null } {
  const when = payload.when;
  const w = typeof when === 'object' && when !== null ? when as Record<string, unknown> : {};
  return { says: textOf(w.says), passage: textOf(w.passage) };
}

/** What a quote "quoted", as the matched conditions say it: `it`, or the passage; then ` saying “phrase”`. `most` shortens each; Infinity is whole. */
export function quotedWords(c: { readonly passage?: string | null; readonly says?: string | null }, most: number = QUOTE_SHORT): string {
  return `${c.passage ? shortQuote(c.passage, most) : 'it'}${c.says ? ` saying ${shortQuote(c.says, most)}` : ''}`;
}

/**
 * The line above a card's own rows in the Lens when the card landed from a back: "Set face down by Pipewrench on November 5; sprang when
 * Spritey quoted it." It names characters and a date and nothing private. A reaction names no one (who reacted is private): "sprang on a reaction".
 * `zone` is the reader's own zone (the default), a test's UTC.
 */
export function sprungWords(f: SprungFacts, zone?: string): string {
  const day = f.setAt === null ? null : new Date(f.setAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(zone ? { timeZone: zone } : {}) });
  const set = `Set face down by ${f.setter ?? 'someone'}${day ? ` on ${day}` : ''}`;
  const by = f.quoter ?? 'a post';
  const did = f.trigger === 'quote' ? `sprang when ${by} quoted ${quotedWords(f, Infinity)}` : f.trigger === 'reply' ? `sprang when ${by} replied to it` : f.trigger === 'reaction' ? 'sprang on a reaction' : 'sprang';
  return `${set}; ${did}.`;
}

/**
 * Where a caught play's card went: the setter's character where the spring says it caught (`did`, written from the face-down Moves on) and the setter is a
 * player; `{}` where the card was spent (a spring written before, or a staff setter, which takes nothing); null where it could not be read, the setter's character included.
 */
export async function readCaughtFate(api: Pick<KayfaApi, 'actsById' | 'characters'>, spring: Id): Promise<{ readonly taken?: string } | null> {
  const [sprang] = await api.actsById([spring]);
  if (!sprang || sprang.kind !== 'spring') return null;
  if (sprang.payload.did !== 'caught' || sprang.character === null) return {};
  const [setter] = await api.characters([sprang.character]);
  /* A setter that could not be read is no claim at all: the card was not shown to be spent. */
  if (!setter) return null;
  return setter.staff === undefined ? { taken: setter.name } : {};
}
