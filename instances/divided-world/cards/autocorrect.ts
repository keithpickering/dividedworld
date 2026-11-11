/**
 * Autocorrect (Pepperoni, common): the caster types a phrase and a replacement, and every occurrence of the phrase in the post,
 * whole words in any case, is covered by a strip of label tape bearing the replacement (docs/plans/2026-11-03-autocorrect-design.md).
 * It is Minus World's signature spell, and the Jabroni's starter card.
 *
 * Its rules here are its bounds, where it lands, its price and the author's saved peels; the strips are the screens' to draw
 * (autocorrect/Effect.tsx). Both find the phrase with one matcher (autocorrect/match.ts) over the post's visible text, so the
 * strips the screens lay are the occurrences the server priced.
 *
 * - **The phrase** is 4 to 100 characters with at least 4 letters or digits, so tiny words cannot be carpet-bombed cheaply.
 * - **The replacement** is one line of plain text, 1 to 100 characters, and never the phrase itself (ignoring case). BBCode in
 *   it is kept as the text it is: the strip draws it as a string and never parses it.
 * - **It lands** only where its phrase is in the post's own words (a quote, code or a link is not; a cast whose phrase is not there
 *   is refused in plain words), up to three deep. The replacement is never the phrase as the matcher reads it (case-folded alike).
 * - **Its price** is the base price at the machine, plus `perVolume` for each `volumeStep` characters it covers (occurrences
 *   times the phrase's length), never more than `mostAdded` in all, as Whoops!'s long-post price is. Priced against the version
 *   the play was decided on; play_card refuses it if the post has another (0070), and strips then follow later edits for free.
 * - **Its state** is the post author's peels, by occurrence in the post's current version (the second "Mario" stays peeled),
 *   which every reader loads, and `clean` once none is left. A reader's own peels are never saved. `stuck` is what the author
 *   half-peeled: for a strip's place (a decimal string), the stretches of it still stuck, each `[from, to, edges]` in shares of
 *   the strip's length (to 4 places) with `edges` = `startKind * 3 + endKind`, a kind being 0 the strip's own end (only at share
 *   0 or 1), 1 a peel line where the roll waits, 2 a tear. A place is in `peeled` or in `stuck`, never both.
 */
import { economyOf, landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { occurrences, sameWords } from './autocorrect/match.ts';

export const PHRASE = { least: 4, most: 100 } as const;
export const REPLACEMENT = { most: 100 } as const;
/**
 * The most occurrences a saved peel can name: a post at the instance's longest (20,000 characters) holds at most 4,000 of the
 * shortest phrase with a space after each, and this leaves room above it. Its largest save fits effect_state's bound (cards.test.ts).
 */
export const PEELS = { most: 5000 } as const;
/** The most stretches a save holds across all its strips; the largest save fits effect_state's bound (cards.test.ts). */
export const STUCK = { most: 2000 } as const;

/** A stretch of a strip still stuck: [from, to, edges], shares of its length to 4 places, edges = startKind * 3 + endKind (0 the strip's own end, 1 a peel line, 2 a tear). */
export type Stretch = readonly [from: number, to: number, edges: number];

export type AutocorrectConfig = { readonly phrase: string; readonly replacement: string };

const characters = (s: string) => [...s].length;
const WORDISH = /[\p{L}\p{N}]/gu;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;

export const autocorrect: CardRules<AutocorrectConfig> = {
  key: 'autocorrect',
  name: 'Autocorrect',
  alignment: 'pepperoni',
  rarity: 'common',
  setPhrase: (config) => config.phrase,
  stack: 3,
  /** What the tape's screens read: how fast a strip peels (px a second), the hold before a pick (ms), a drag's give (px), how long a peeked corner stays (ms) and settles back (px a second). */
  screenReads: [
    { key: 'autocorrect.pace', whole: true, min: 20, max: 400 },
    { key: 'autocorrect.pickMs', whole: true, min: 0, max: 2000 },
    { key: 'autocorrect.give', whole: true, min: 8, max: 200 },
    { key: 'autocorrect.peekStayMs', whole: true, min: 0, max: 5000 },
    { key: 'autocorrect.peekSettle', whole: true, min: 20, max: 2000 },
  ],
  reads: [{ key: 'autocorrect.perVolume', whole: true, min: 0 }, { key: 'autocorrect.volumeStep', whole: true, min: 1 }, { key: 'autocorrect.mostAdded', whole: true, min: 1 }],
  playPrice: (settings, target, config) => {
    if (target.reach !== 'post') return 0;
    const room = economyOf(settings, 'autocorrect.mostAdded');
    // A face asks the most a play could add, before anyone has typed a phrase (engine/ui/cards/faces.ts).
    if (typeof config?.phrase !== 'string') return Math.max(0, room);
    const volume = occurrences(target.text, config.phrase).length * characters(config.phrase);
    return Math.max(0, Math.min(economyOf(settings, 'autocorrect.perVolume') * Math.floor(volume / economyOf(settings, 'autocorrect.volumeStep')), room));
  },
  canApply: (target, effects, config, now) => {
    const lands = landsOn(autocorrect, target, effects, now);
    // The screens ask with whatever the form holds, which before a phrase is typed (or from another card's form) has none.
    if (!lands.ok || typeof config?.phrase !== 'string' || target.reach !== 'post') return lands;
    return occurrences(target.text, config.phrase).length ? lands : refuse(`“${config.phrase}” is not in this post's own words`);
  },
  staffOptions: {
    prompt: 'Choose the words to cover and what to cover them with. The phrase must be copied exactly from the post you are replying to: whole words, on one line, at least 4 letters or digits and up to 100 characters. The replacement is one line of other words, up to 100 characters.',
    schema: { type: 'object', properties: { phrase: { type: 'string' }, replacement: { type: 'string' } }, required: ['phrase', 'replacement'], additionalProperties: false },
  },
  validateConfig: (config) => {
    const { phrase: p, replacement: r } = typeof config === 'object' && config !== null ? (config as { phrase?: unknown; replacement?: unknown }) : {};
    if (typeof p !== 'string') return refuse('the phrase is the words to cover');
    if (typeof r !== 'string') return refuse('the replacement is the words to cover them with');
    const [phrase, replacement] = [p.trim(), r.trim()];
    if (characters(phrase) > PHRASE.most) return refuse(`the phrase is at most ${PHRASE.most} characters`);
    if ((phrase.match(WORDISH) ?? []).length < PHRASE.least) return refuse(`the phrase has at least ${PHRASE.least} letters or digits`);
    if (LINE_BREAK.test(phrase)) return refuse('the phrase is one line');
    if (!replacement) return refuse('the replacement is some words, not nothing');
    if (characters(replacement) > REPLACEMENT.most) return refuse(`the replacement is at most ${REPLACEMENT.most} characters`);
    if (LINE_BREAK.test(replacement)) return refuse('the replacement is one line');
    if (sameWords(phrase, replacement)) return refuse('the replacement is other words, not the phrase itself');
    return ok({ phrase, replacement });
  },
  validateState: (state) => {
    const { peeled, clean, stuck } = typeof state === 'object' && state !== null ? (state as { peeled?: unknown; clean?: unknown; stuck?: unknown }) : {};
    if (!Array.isArray(peeled)) return refuse('peeled is a list of places');
    if (clean !== undefined && typeof clean !== 'boolean') return refuse('clean is true or false');
    if (!peeled.every((n) => Number.isSafeInteger(n) && n >= 0 && n < PEELS.most)) return refuse(`a place is a whole number from 0 to ${PEELS.most - 1}`);
    const kept = [...new Set(peeled as number[])].sort((a, b) => a - b);
    let keptStuck: Record<string, Stretch[]> | undefined;
    if (stuck !== undefined) {
      if (typeof stuck !== 'object' || stuck === null || Array.isArray(stuck)) return refuse('stuck is a list of stretches for each place');
      const places = new Set(kept);
      const out: Record<string, Stretch[]> = {};
      let total = 0;
      for (const [key, stretches] of Object.entries(stuck)) {
        const place = Number(key);
        if (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(place) || place >= PEELS.most) return refuse(`a place is a whole number from 0 to ${PEELS.most - 1}`);
        if (places.has(place)) return refuse('a place is in peeled or in stuck, never both');
        if (!Array.isArray(stretches)) return refuse('stuck holds a list of stretches for each place');
        if (!stretches.length) return refuse('a place in stuck holds at least one stretch');
        total += stretches.length;
        if (total > STUCK.most) return refuse(`a save holds at most ${STUCK.most} stretches`);
        const rounded: Stretch[] = [];
        for (const s of stretches) {
          if (!Array.isArray(s) || s.length !== 3 || !s.every((n) => typeof n === 'number')) return refuse('a stretch is [from, to, edges], three numbers');
          const [from, to, edges] = s as [number, number, number];
          if (!(from >= 0 && from <= 1 && to >= 0 && to <= 1)) return refuse('a share is from 0 to 1');
          if (!Number.isInteger(edges) || edges < 0 || edges > 8) return refuse('edges is a whole number from 0 to 8');
          const [a, b] = [Math.round(from * 10_000) / 10_000, Math.round(to * 10_000) / 10_000];
          if (!(a < b)) return refuse('a stretch is from before to');
          if (Math.floor(edges / 3) === 0 && a !== 0) return refuse("a stretch starts at the strip's own end only at share 0");
          if (edges % 3 === 0 && b !== 1) return refuse("a stretch ends at the strip's own end only at share 1");
          const last = rounded[rounded.length - 1];
          if (last && a < last[1]) return refuse('a place\'s stretches are in order and do not overlap');
          rounded.push([a, b, edges]);
        }
        out[key] = rounded;
      }
      if (total) keptStuck = out;
    }
    return ok({ peeled: kept, ...(clean === undefined ? {} : { clean }), ...(keptStuck ? { stuck: keptStuck } : {}) });
  },
};
