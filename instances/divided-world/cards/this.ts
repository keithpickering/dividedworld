/**
 * THIS (Pepperoni, common): the caster points at a phrase of a post and says what they like about it, and every reader sees an arrow
 * pointing at the phrase, with the caster's words after THIS (docs/plans/2026-11-13-this-design.md, sections 1 and 4).
 *
 * Its rules here are its bounds and where it lands; the arrow is the screens' to draw. It is free to set, as Feelin' Fab's face is.
 *
 * - **The phrase** is the one phrase bound (cards/phrase-bound.ts): 4 to 100 characters with at least 4 letters or digits, on one line.
 * - **The words** are optional, one line of plain text, at most 60 characters; none is `''`.
 * - **It lands** only where its phrase is in the post's own words (a quote, code or a link is not; a cast whose phrase is not there is
 *   refused in plain words), up to three deep, as Autocorrect does, and on the caster's own post as on any.
 */
import { landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { occurrences } from './autocorrect/match.ts';
import { LINE_BREAK, boundedPhrase, characters } from './phrase-bound.ts';

export const WORDS = { most: 60 } as const;

export type ThisConfig = { readonly phrase: string; readonly words: string };

export const thisCard: CardRules<ThisConfig> = {
  key: 'this',
  name: 'THIS',
  alignment: 'pepperoni',
  rarity: 'common',
  reaches: ['post'],
  stack: 3,
  setPhrase: (config) => config.phrase,
  playPrice: () => 0,
  canApply: (target, effects, config, now) => {
    const lands = landsOn(thisCard, target, effects, now);
    // The screens ask with whatever the form holds, which before a phrase is typed (or from another card's form) has none.
    if (!lands.ok || typeof config?.phrase !== 'string' || target.reach !== 'post') return lands;
    return occurrences(target.text, config.phrase).length ? lands : refuse(`“${config.phrase}” is not in this post's own words`);
  },
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
