/**
 * What every screen that shows a card (the Vending Machine, the hand, the hand's sheet) needs to
 * know about it, joined once: the rules' name, alignment and prices, and the instance's face and
 * words (`CardUi`). A card the instance gives no `CardUi` still has a face here, in the glass's
 * plain tokens, so a rule without art is bought, held and played all the same.
 *
 * Prices are the rules' own, read from the settings the screen was given: the base price the
 * Vending Machine sells at (`basePrice`), and what playing the card on a very long post costs on
 * top of it, which says whether the price reads "1.00" or "1.00+" and how much more a long post
 * can cost. A card whose rules refuse the probe is shown at its base price alone.
 */
import { basePrice, type CardRules } from '../../rules/cards.ts';
import type { Alignment, Settings } from '../../rules/types.ts';
import type { CardArt, CardUi } from './types.ts';

/** A post long enough that any length-based price has reached its most. */
const VERY_LONG = 1_000_000;

export interface CardFace {
  readonly key: string;
  readonly name: string;
  readonly alignment: Alignment;
  /** The alignment as a tag reads it: "Sweet", "Salty". */
  readonly tag: string;
  /** What the machine sells it for, in hundredths. */
  readonly price: number;
  /** What playing it on a very long post costs on top of the price, in hundredths; 0 for a card whose play costs nothing more. */
  readonly extra: number;
  /** How many of it one post takes (1 unless the rules say more). */
  readonly stack: number;
  readonly art: CardArt;
  readonly tagline: string;
  /** The card's rules in one sentence, for a large face; the full `describe` where the instance gave none. */
  readonly summary: string;
  /** The card's rules in plain words. */
  readonly describe: string;
}

/** Hundredths of an orb as the screens say them: 100 is "1.00". */
export const orbs = (hundredths: number): string => (hundredths / 100).toFixed(2);

/** The alignment as a tag reads it. */
export const alignmentTag = (alignment: Alignment): string => alignment.charAt(0).toUpperCase() + alignment.slice(1);

/** The price as a card's face says it: "1.00", or "1.00+" where playing it on a long post costs more. */
export const priceOf = (face: Pick<CardFace, 'price' | 'extra'>): string => `${orbs(face.price)}${face.extra > 0 ? '+' : ''}`;

/** The face a card with no `CardUi` has: the tokens' own, no picture. */
const PLAIN: CardArt = { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)' };

function extraOf(rules: CardRules, settings: Settings): number {
  try {
    return Math.max(0, rules.playPrice(settings, { act: '', kind: 'post', length: VERY_LONG }, {}));
  } catch {
    return 0;
  }
}

/** One card's face, from its rules and what the instance gave it. */
export function faceOf(rules: CardRules, ui: CardUi | undefined, settings: Settings): CardFace {
  const describe = ui ? ui.describe(settings) : '';
  return {
    key: rules.key,
    name: rules.name,
    alignment: rules.alignment,
    tag: alignmentTag(rules.alignment),
    price: basePrice(rules, settings),
    extra: extraOf(rules, settings),
    stack: rules.stack ?? 1,
    art: ui?.art ?? PLAIN,
    tagline: ui?.art.tagline ?? '',
    summary: ui?.summary ?? describe,
    describe,
  };
}

/** Every card the instance sells, in the order its rules list them. */
export function facesOf(cards: readonly CardRules[], uis: readonly CardUi[], settings: Settings): readonly CardFace[] {
  return cards.map((rules) => faceOf(rules, uis.find((u) => u.key === rules.key), settings));
}
