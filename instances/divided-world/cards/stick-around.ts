/**
 * Stick Around (Sweet): once the post scrolls into view, the reader is held, and each scroll
 * that ends anywhere else brings the page back to it, until they check the caster's own
 * sentence or scroll hard enough to break through (design, section 7). Its rules here are its
 * price and its sentence; the hold itself is the screens' to draw, and its release is kept on
 * the reader's own device, never the server.
 */
import { landsOncePerPost, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';

const DEFAULT_SENTENCE = 'I legally certify that I have read this post in full and thought about it contemplatively';
const MOST = 200;

export const stickAround: CardRules<{ sentence: string }> = {
  key: 'stick-around',
  name: 'Stick Around',
  alignment: 'sweet',
  priceKey: 'stickAround.price',
  playPrice: () => 0,
  canApply: (target, effects) => landsOncePerPost('stick-around', target, effects),
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
