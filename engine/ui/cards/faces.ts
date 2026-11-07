/**
 * What every screen that shows a card (the Vending Machine, the hand, the hand's sheet) needs to
 * know about it, joined once: the rules' name, alignment and prices, and the instance's face and
 * words (`CardUi`). A card the instance gives no `CardUi` still has a face here, in the glass's
 * plain tokens, so a rule without art is bought, held and played all the same.
 *
 * A card's face has no buy price: that is its slot's at the machine, which changes with an admin's hand, so a screen that shows one
 * reads the card's on-sale slot from `KayfaApi.machine` (`saleOf`) and shows none where there is none. What playing the card on a very
 * long post costs on top of a price is the rules' own, read from the settings the screen was given, the
 * server's economy laid over the compiled one (`withCardEconomy`): it says whether the price reads "1.00" or "1.00+" and how
 * much more a long post can cost. A card whose rules refuse the probe is shown at its price alone.
 */
import type { Slot } from '../data/api.ts';
import { playOf, type CardRules, type Play, type Rarity } from '../../rules/cards.ts';
import type { Alignment, Settings } from '../../rules/types.ts';
import type { CardArt, CardUi } from './types.ts';

/** A post long enough that any length-based price has reached its most. */
const VERY_LONG = 1_000_000;

/** The art a face carries: a card with no `CardUi` has only the color and ink of the glass's tokens. */
export type FaceArt = Pick<CardArt, 'color' | 'ink'> & Partial<Pick<CardArt, 'canvas' | 'mark' | 'credit' | 'tagline'>>;

export interface CardFace {
  readonly key: string;
  readonly name: string;
  readonly alignment: Alignment;
  /** The alignment as a tag reads it: "Sweet", "Salty". */
  readonly tag: string;
  /** What playing it on a very long post costs on top of its price at the machine, in hundredths; 0 for a card whose play costs nothing more. */
  readonly extra: number;
  /** How many of it one post takes (1 unless the rules say more). */
  readonly stack: number;
  readonly art: FaceArt;
  readonly tagline: string;
  /** The card's rules in one sentence, for a large face; the full `describe` where the instance gave none. */
  readonly summary: string;
  /** The card's rules in plain words. */
  readonly describe: string;
  /** How rare it is: drawn as the corner gem, whose shape says it (never its color alone). */
  readonly rarity: Rarity;
  /** How it is played: its word on the face ("Set"). */
  readonly play: Play;
}

/** The corner gem's shape for each rarity, so a rarity is told by its shape and its name, never by color alone. */
const GEMS: Readonly<Record<Rarity, string>> = { common: '●', uncommon: '◆', rare: '★', legendary: '✦' };
export const gemOf = (rarity: Rarity): string => GEMS[rarity] ?? GEMS.common;
/** A rarity's name, as a gem's title says it: "Uncommon". */
export const rarityName = (rarity: Rarity): string => rarity.charAt(0).toUpperCase() + rarity.slice(1);
/** A play's word on a card's face: "Cast", "Use", "Set", "Keep". */
export const playWord = (play: Play): string => play.charAt(0).toUpperCase() + play.slice(1);

/** Hundredths of an orb as the screens say them: 100 is "1.00". */
export const orbs = (hundredths: number): string => (hundredths / 100).toFixed(2);

/** The server's words for a refusal, or the screen's own, said plainly: orbs and not hundredths, a capital and a stop. */
export function plainRefusal(error: string): string {
  const spent = /^that costs (\d+), and your wallet holds (\d+)$/.exec(error);
  if (spent) return `That costs ${orbs(Number(spent[1]))}, and your wallet holds ${orbs(Number(spent[2]))}.`;
  const said = error.charAt(0).toUpperCase() + error.slice(1);
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/** The alignment as a tag reads it. */
export const alignmentTag = (alignment: Alignment): string => alignment.charAt(0).toUpperCase() + alignment.slice(1);

/** A price as a screen says it: "1.00", or "1.00+" where playing the card on a long post costs more (`CardFace.extra`). */
export const priceOf = (price: number, extra: number): string => `${orbs(price)}${extra > 0 ? '+' : ''}`;

/**
 * The slot that sells a card now: its on-sale slot. A card with no slot, a hidden one (which the machine does not list), a sold out one,
 * or no look at the machine yet has none, and a screen shows no price for it.
 */
export const saleOf = (slots: readonly Slot[] | null | undefined, card: string): Slot | null =>
  slots?.find((s) => 'card' in s.item && s.item.card === card && s.availability === 'onSale') ?? null;

/**
 * What a card's price cell says: the on-sale slot's price (with the card's "+" where playing it can cost more), "Sold out" for a
 * slot that is sold out, "Not on sale" for a card with no slot the machine lists (a hidden one, or none), "Price unavailable" where the
 * machine could not be read, and nothing while the first read has not answered.
 */
export function priceWords(look: { readonly slots: readonly Slot[] | null; readonly status: 'loading' | 'ready' | 'failed' }, card: string, extra: number): string {
  if (look.status === 'failed') return 'Price unavailable';
  if (look.slots === null) return '';
  const sale = saleOf(look.slots, card);
  if (sale) return priceOf(sale.price, extra);
  return look.slots.some((s) => 'card' in s.item && s.item.card === card && s.availability === 'soldOut') ? 'Sold out' : 'Not on sale';
}

/** The face a card with no `CardUi` has: the tokens' own, no picture. */
const PLAIN: FaceArt = { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)' };

function extraOf(rules: CardRules, settings: Settings): number {
  try {
    return Math.max(0, rules.playPrice(settings, { reach: 'post', act: '', kind: 'post', length: VERY_LONG, text: '' }, {}));
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
    extra: extraOf(rules, settings),
    stack: rules.stack ?? 1,
    art: ui?.art ?? PLAIN,
    tagline: ui?.art.tagline ?? '',
    summary: ui?.summary ?? describe,
    describe,
    rarity: rules.rarity,
    play: playOf(rules),
  };
}

/**
 * The settings a card's rules are read with on a screen: the compiled ones, with the economy numbers the server prices with now laid over
 * them (`ScreenSettings.cardEconomy`, 0039_card_economy.sql), so a number an admin has tuned shows as the server will use it. A
 * key the server did not give, or gave as anything but a number, is the compiled economy's.
 */
export function withCardEconomy(settings: Settings, cardEconomy: Readonly<Record<string, unknown>> | undefined): Settings {
  const tuned = Object.entries(cardEconomy ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]));
  return tuned.length === 0 ? settings : { ...settings, economy: { ...settings.economy, ...Object.fromEntries(tuned) } };
}

/** Every card the instance sells, in the order its rules list them. */
export function facesOf(cards: readonly CardRules[], uis: readonly CardUi[], settings: Settings): readonly CardFace[] {
  return cards.map((rules) => faceOf(rules, uis.find((u) => u.key === rules.key), settings));
}
