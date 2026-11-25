/**
 * Stick Around (Sweet): once the post settles in view, the reader is pulled to it and the post
 * fills their screen, until they check the caster's own sentence or fill a draining bar by
 * scrolling hard past either end of it, or by pressing Break free (design, section 10 as amended
 * 2026-10-30). Its rules here are its
 * price and its sentence; the hold itself is the screens' to draw. A reader's release is kept on
 * the server, per account (effect_releases, supabase/migrations/0016_cards_screens.sql), so it
 * follows them from a phone to a desktop; breaking free lasts the visit, and is not kept
 * (the screens' design, sections 6 and 10).
 */
import { landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { textField, who } from './seen-words.ts';

const DEFAULT_SENTENCE = 'I legally certify that I have read this post in full and thought about it contemplatively';
const MOST = 200;

export const stickAround: CardRules<{ sentence: string }> = {
  key: 'stick-around',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Stick Around',
  alignment: 'sweet',
  rarity: 'common',
  seen: (p) => {
    const sentence = textField(p.config, 'sentence', 200);
    return `${who(p)} made this post stick to readers, ${p.ago}: it pulls them in and fills their screen, and they have to ${sentence === null ? 'check the caster\'s sentence' : `check a box swearing “${sentence}”`} to be let go.`;
  },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(stickAround, target, effects, now),
  staffOptions: {
    prompt: 'Optionally choose the sentence a reader must check to be let go, at most 200 characters. Leave it out to use the usual one.',
    schema: { type: 'object', properties: { sentence: { type: 'string' } }, additionalProperties: false },
  },
  validateConfig: (config) => {
    const given = typeof config === 'object' && config !== null ? (config as { sentence?: unknown }).sentence : undefined;
    if (given === undefined) return ok({ sentence: DEFAULT_SENTENCE });
    if (typeof given !== 'string') return refuse('the release is a sentence');
    const sentence = given.trim();
    if (!sentence) return refuse('the release is a sentence, not nothing');
    if ([...sentence].length > MOST) return refuse(`the release is at most ${MOST} characters`);
    return ok({ sentence });
  },
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
