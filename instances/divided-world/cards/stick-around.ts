/**
 * Stick Around (Sweet): once the post scrolls into view, the reader is held, and each scroll
 * that ends anywhere else brings the page back to it, until they check the caster's own
 * sentence or scroll hard enough to break through (design, section 7). Its rules here are its
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
