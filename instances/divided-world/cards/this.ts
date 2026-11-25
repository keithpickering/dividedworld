/**
 * THIS (Pepperoni, common): the caster points at a phrase of a post and says something about it (agreeing or not), and every reader sees an arrow
 * pointing at the phrase, with the caster's words after THIS (docs/plans/2026-11-13-this-design.md, sections 1 and 4).
 *
 * Its rules here are its bounds and where it lands; the arrow is the screens' to draw. It is free to set, as Feelin' Fab's face is.
 *
 * - **The phrase** is the one phrase bound (cards/phrase-bound.ts): 4 to 100 characters with at least 4 letters or digits, on one line.
 * - **The words** are optional, one line of plain text, at most 60 characters; none is `''`.
 * - **It lands** only where its phrase is in the post's own words (a quote, code or a link is not; a cast whose phrase is not there is
 *   refused in plain words), up to three deep, as Autocorrect does, and on the caster's own post as on any.
 * - **A persona** is offered it with its options (`staffOptions`), and words that run long are trimmed (`repairStaff`, below).
 */
import { landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { occurrences } from './autocorrect/match.ts';
import { LINE_BREAK, boundedPhrase, characters } from './phrase-bound.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { textField, who } from './seen-words.ts';

export const WORDS = { most: 60 } as const;

export type ThisConfig = { readonly phrase: string; readonly words: string };

/** A stretch of a post's visible text, as the engine's text runs name one. */
export type Stretch = { readonly start: number; readonly end: number };

/**
 * Where THIS points: the first place `phrase` is in `text` by the card's one matcher, or null. A phrase that is there more than once points at
 * the first, so one rule holds at a cast, at a spring and after any edit.
 */
export function pointsAt(text: string, phrase: string): Stretch | null {
  const first = occurrences(text, phrase)[0];
  return first ? { start: first.from, end: first.to } : null;
}

/**
 * A persona's words repaired (design, section 4): words past 60 characters are cut to the longest stretch that ends at a word's end (the last white
 * space within the first 61 characters; with none, the first 60), counted and cut by characters, so no surrogate pair is split (a joined emoji may be). The cut is at the white space even where that keeps one short word, since the first 60
 * characters would end inside a word. The trim is
 * named. Nothing else is repaired: a phrase that is not in the post, or is out of bounds, is returned as given and the decision refuses in the card's words.
 */
function repairWords(config: unknown): { readonly config: unknown; readonly trims: readonly { readonly path: string; readonly predicate: string; readonly before: number; readonly after: number }[] } {
  const words = typeof config === 'object' && config !== null ? (config as { words?: unknown }).words : undefined;
  if (typeof words !== 'string') return { config, trims: [] };
  const all = [...words.trim()];
  if (all.length <= WORDS.most) return { config, trims: [] };
  const head = all.slice(0, WORDS.most + 1);
  const space = head.reduce((last, c, i) => (/\s/u.test(c) ? i : last), -1);
  const kept = (space > 0 ? head.slice(0, space) : head.slice(0, WORDS.most)).join('').trim();
  return { config: { ...(config as object), words: kept }, trims: [{ path: 'card.config.this.words', predicate: 'mostSixtyCharacters', before: all.length, after: characters(kept) }] };
}

export const thisCard: CardRules<ThisConfig> = {
  key: 'this',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'THIS',
  alignment: 'pepperoni',
  rarity: 'common',
  reaches: ['post'],
  stack: 3,
  setPhrase: (config) => config.phrase,
  seen: (p) => {
    const phrase = textField(p.config, 'phrase', 80), words = textField(p.config, 'words', 60);
    const note = words === null ? 'THIS' : `THIS ${words}`;
    return `${who(p)} pointed an arrow at ${phrase === null ? 'some of the words in this post' : `“${phrase}”`}, ${p.ago}, with a note: “${note}”.`;
  },
  playPrice: () => 0,
  canApply: (target, effects, config, now) => {
    const lands = landsOn(thisCard, target, effects, now);
    // The screens ask with whatever the form holds, which before a phrase is typed (or from another card's form) has none.
    if (!lands.ok || typeof config?.phrase !== 'string' || target.reach !== 'post') return lands;
    return occurrences(target.text, config.phrase).length ? lands : refuse(`“${config.phrase}” is not in this post's own words`);
  },
  staffOptions: {
    prompt: 'Choose the words in the post to point at, and what to say about them. The phrase must be copied exactly from the post you are replying to: whole words, on one line, at least 4 letters or digits and up to 100 characters. The note reads THIS and then your words: one line of up to 60 characters, or none.',
    schema: {
      type: 'object',
      properties: { phrase: { type: 'string' }, words: { type: 'string' } },
      required: ['phrase', 'words'],
      additionalProperties: false,
    },
  },
  repairStaff: repairWords,
  validateConfig: (config) => {
    const { phrase: p, words: w = '' } = typeof config === 'object' && config !== null ? (config as { phrase?: unknown; words?: unknown }) : {};
    if (typeof p !== 'string') return refuse('the phrase is the words to point at');
    const bounded = boundedPhrase(p);
    if (!bounded.ok) return refuse(bounded.why);
    if (typeof w !== 'string') return refuse('the words are what the note says after THIS');
    const words = w.trim();
    if (characters(words) > WORDS.most) return refuse(`the words are at most ${WORDS.most} characters`);
    if (LINE_BREAK.test(words)) return refuse('the words are one line');
    return ok({ phrase: bounded.phrase, words });
  },
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 20;
