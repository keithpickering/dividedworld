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
 *   times the phrase's length), never more than `mostInAll` in all, as Whoops!'s long-post price is. Priced against the version
 *   the play was decided on; play_card refuses it if the post has another (0070), and strips then follow later edits for free.
 * - **Its state** is the post author's peels, by occurrence in the post's current version (the second "Mario" stays peeled),
 *   which every reader loads, and `clean` once none is left. A reader's own peels are never saved.
 */
import { basePrice, economyOf, landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { occurrences, sameWords } from './autocorrect/match.ts';

export const PHRASE = { least: 4, most: 100 } as const;
export const REPLACEMENT = { most: 100 } as const;
/**
 * The most occurrences a saved peel can name: a post at the instance's longest (20,000 characters) holds at most 4,000 of the
 * shortest phrase with a space after each, and this leaves room above it. Its largest save fits effect_state's bound (cards.test.ts).
 */
export const PEELS = { most: 5000 } as const;

export type AutocorrectConfig = { readonly phrase: string; readonly replacement: string };

const characters = (s: string) => [...s].length;
const WORDISH = /[\p{L}\p{N}]/gu;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;

export const autocorrect: CardRules<AutocorrectConfig> = {
  key: 'autocorrect',
  name: 'Autocorrect',
  alignment: 'pepperoni',
  rarity: 'common',
  priceKey: 'autocorrect.price',
  stack: 3,
  /** The share of a strip's peel a held key stands for, in milliseconds (the effect's, read by the screens): about as long as a drag takes. */
  screenReads: [{ key: 'autocorrect.peelMs', whole: true, min: 100, max: 5000 }],
  reads: [{ key: 'autocorrect.perVolume', whole: true, min: 0 }, { key: 'autocorrect.volumeStep', whole: true, min: 1 }, { key: 'autocorrect.mostInAll', whole: true, min: 1 }],
  playPrice: (settings, target, config) => {
    if (target.reach !== 'post') return 0;
    const room = economyOf(settings, 'autocorrect.mostInAll') - basePrice(autocorrect, settings);
    // A face asks the most a play could add, before anyone has typed a phrase (engine/ui/cards/faces.ts).
    if (typeof config?.phrase !== 'string') return Math.max(0, room);
    const volume = occurrences(target.text, config.phrase).length * characters(config.phrase);
    return Math.max(0, Math.min(economyOf(settings, 'autocorrect.perVolume') * Math.floor(volume / economyOf(settings, 'autocorrect.volumeStep')), room));
  },
  canApply: (target, effects, config, now) => {
    const lands = landsOn(autocorrect, target, effects, now);
    if (!lands.ok || !config || target.reach !== 'post') return lands;
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
    const { peeled, clean } = typeof state === 'object' && state !== null ? (state as { peeled?: unknown; clean?: unknown }) : {};
    if (!Array.isArray(peeled)) return refuse('peeled is a list of places');
    if (clean !== undefined && typeof clean !== 'boolean') return refuse('clean is true or false');
    if (!peeled.every((n) => Number.isSafeInteger(n) && n >= 0 && n < PEELS.most)) return refuse(`a place is a whole number from 0 to ${PEELS.most - 1}`);
    const kept = [...new Set(peeled as number[])].sort((a, b) => a - b);
    return ok(clean === undefined ? { peeled: kept } : { peeled: kept, clean });
  },
};
