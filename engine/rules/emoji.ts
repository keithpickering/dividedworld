import { ok, refuse, type Verdict } from './cards.ts';
import { QUADRANTS, type Quadrant, type ReactionKind } from './types.ts';

/**
 * A reaction a card adds to one post (card notes, Part 3): one emoji and the quadrant it scores in, kept apart from the instance's own set.
 * Pure: the database holds the same key shape (`x-` and hex code points), so a tally row is drawn anywhere with no second read.
 */

/** What a post-local reaction's key starts with; `instanceProblems` keeps an instance's own reaction keys off it. */
export const LOCAL_PREFIX = 'x-';

/*
 * One RGI emoji. The repository targets ES2022, where a regex literal with the v flag does not compile, so it is built at run time; a runtime
 * without the flag (an older browser's preview) falls back to a pictograph at the grapheme's start and leaves the server, which has it, to decide.
 */
let rgi: RegExp;
try { rgi = new RegExp('^\\p{RGI_Emoji}$', 'v'); } catch { rgi = /^\p{Extended_Pictographic}/u; }

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (s: string): string[] => [...segmenter.segment(s)].map((g) => g.segment);

/** The trimmed text when it is exactly one grapheme that is one RGI emoji, else null. */
export function singleEmoji(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  const parts = graphemes(t);
  return parts.length === 1 && rgi.test(t) ? t : null;
}

/** The emoji without its variation selector (U+FE0F) and skin tone (U+1F3FB to U+1F3FF), for comparing: `❤` is `❤️`, and `👍🏽` is `👍`. */
export function emojiBase(emoji: string): string {
  return emoji.replace(/[️\u{1F3FB}-\u{1F3FF}]/gu, '');
}

/** `x-` and the emoji's code points in lower-case hex, joined by hyphens (`💀` is `x-1f480`); it fits the key pattern `^[a-z][a-z0-9-]*$`. */
export function localKey(emoji: string): string {
  return LOCAL_PREFIX + [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join('-');
}

/** The emoji a local key stands for, or null for any other key (an instance's reaction, or hex that is no one emoji). */
export function emojiOfKey(key: string): string | null {
  if (!key.startsWith(LOCAL_PREFIX)) return null;
  const hex = key.slice(LOCAL_PREFIX.length).split('-');
  if (!hex.every((h) => /^[0-9a-f]{1,6}$/.test(h))) return null;
  const points = hex.map((h) => parseInt(h, 16));
  if (points.some((p) => p > 0x10ffff)) return null;
  const emoji = String.fromCodePoint(...points);
  return singleEmoji(emoji) === emoji ? emoji : null;
}

/** The one validator a `reaction` card's `validateConfig` calls: the emoji, then the quadrant, each refused in the caster's words. */
export function localReaction(config: unknown, instanceReactions: readonly Pick<ReactionKind, 'emoji'>[]): Verdict<{ emoji: string; quadrant: Quadrant }> {
  const c = typeof config === 'object' && config !== null ? config as { emoji?: unknown; quadrant?: unknown } : {};
  const emoji = singleEmoji(c.emoji);
  if (emoji === null) {
    const parts = typeof c.emoji === 'string' ? graphemes(c.emoji.trim()) : [];
    return refuse(parts.length > 1 && parts.every((g) => rgi.test(g)) ? 'that is more than one emoji' : 'choose one emoji');
  }
  const base = emojiBase(emoji);
  if (instanceReactions.some((r) => emojiBase(r.emoji) === base)) return refuse('this forum already has that reaction');
  if (!QUADRANTS.includes(c.quadrant as Quadrant)) return refuse('choose the quadrant it scores in');
  return ok({ emoji, quadrant: c.quadrant as Quadrant });
}
