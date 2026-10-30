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
import { landsOnPost, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';

const DEFAULT_SENTENCE = 'I legally certify that I have read this post in full and thought about it contemplatively';
const MOST = 200;

export const stickAround: CardRules<{ sentence: string }> = {
  key: 'stick-around',
  name: 'Stick Around',
  alignment: 'sweet',
  priceKey: 'stickAround.price',
  playPrice: () => 0,
  canApply: (target, effects) => landsOnPost(stickAround, target, effects),
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
