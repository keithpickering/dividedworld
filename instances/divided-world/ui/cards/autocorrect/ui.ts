/** Autocorrect's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ConfigForm as AutocorrectConfigForm } from '../../../cards/autocorrect/ConfigForm.tsx';
import type { Settings } from '../../../../../engine/rules/types.ts';
import autocorrectCanvas from './art.webp?url';
import autocorrectMark from './mark.svg?url';
import autocorrectArt from './art.json';
import { orbs, setMoveWords } from '../words.ts';

/** The sentence on the author's hold, left out when there is none. */
const holdWords = (hours: number | undefined) => (hours ? ` The author can't peel any of a play's tape for the first ${hours} hours after it lands.` : '');

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const AutocorrectEffect = lazy(() => import('../../../cards/autocorrect/Effect.tsx').then((m) => ({ default: m.AutocorrectEffect })));

/*
 * Autocorrect (docs/plans/2026-11-03-autocorrect-design.md): Pepperoni's color, as Glitter Bomb is. Its effect is masking
 * tape, written on in marker.
 */
export const ui: CardUi = {
  key: 'autocorrect',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: autocorrectCanvas, mark: autocorrectMark, credit: autocorrectArt.credit, tagline: 'Tape over a word, everywhere.' },
  summary: 'Covers a phrase everywhere it appears in a post with words of your choosing.',
  hint: 'Lift a strip by one end to read what is under it.',
  status: 'Words taped over',
  Effect: AutocorrectEffect,
  ConfigForm: AutocorrectConfigForm,
  surcharge: (settings: Settings) => {
    const e = settings.economy;
    return `Covers a lot, +${orbs(e['autocorrect.perVolume'] ?? 0)} per ${e['autocorrect.volumeStep'] ?? 0} characters covered`;
  },
  describe: (settings: Settings) => {
    const e = settings.economy;
    return `A Pepperoni card, common. You type a phrase and the words to cover it with, and every place the phrase appears in the post's own words, as whole words in any case, gets a strip of tape with your words on it. Any reader can lift a strip to read under it. Only the post's author can peel strips off for everyone, and the author's words are always under the tape and in the post's History.${holdWords(e['autocorrect.holdHours'])} Up to three can stack on one post. ${setMoveWords('the quoting post')} A set one lands only when the quote's own words hold its phrase, and it waits for a quote that does. Playing it costs ${orbs(e['autocorrect.perVolume'] ?? 0)} more for every ${e['autocorrect.volumeStep'] ?? 0} characters it covers, ${orbs(e['autocorrect.mostAdded'] ?? 0)} at most.`;
  },
  logPlay: (config) => (typeof config.phrase === 'string' && typeof config.replacement === 'string' ? `It covers “${config.phrase}” with “${config.replacement}”.` : undefined),
  logSave: (state: unknown) => {
    const { peeled, clean, stuck } = (typeof state === 'object' && state !== null ? state : {}) as { peeled?: unknown; clean?: unknown; stuck?: unknown };
    if (clean === true) return { what: 'Peeled clean', said: 'You peeled every strip it had then.' };
    const n = Array.isArray(peeled) ? peeled.length : 0;
    const m = typeof stuck === 'object' && stuck !== null && !Array.isArray(stuck) ? Object.keys(stuck).length : 0;
    if (!m) return n ? { what: 'Strips peeled', said: `You peeled ${n} of its strips.` } : undefined;
    if (!n) return { what: 'Strips peeled', said: `You started peeling ${m} of its strips.` };
    return { what: 'Strips peeled', said: `You peeled ${n} of its strips, and started on ${m} more.` };
  },
};
