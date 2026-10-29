/**
 * Cards: the interface every instance's cards implement.
 *
 * A card is bought from the Vending Machine at its base price and played on a post, which is
 * an Act of its own, posted in the thread and open to reactions. Its rules decide what it
 * costs to play on a given target, whether it can land there given the effects already on it
 * (so cards can combine later), and whether the caster's configuration is one the card
 * accepts. The browser runs these to preview; the server runs them to decide; the SQL
 * function re-checks what it can.
 */
import type { ActKind, Alignment, Hundredths, Settings } from './types.ts';
import { safeColor } from '../bbcode/parse.ts';

/** The post a card is played on, as its rules see it. */
export interface CardTarget {
  readonly act: string;
  readonly kind: ActKind;
  /** The length of the post's current text, in characters. */
  readonly length: number;
}

/** An effect already on a target: a card played there before. */
export interface CardEffect {
  readonly card: string;
  readonly act: string;
}

export type Verdict<T = undefined> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

export interface CardRules<Config = unknown> {
  readonly key: string;
  readonly name: string;
  readonly alignment: Alignment;
  /** The economy setting that holds what the Vending Machine sells it for. */
  readonly priceKey: string;
  /** The economy numbers its rules read beside its price. */
  readonly reads?: readonly string[];
  /** What playing it on this target costs from the wallet, on top of the base price already paid. */
  playPrice(settings: Settings, target: CardTarget, config: Config): Hundredths;
  canApply(target: CardTarget, effectsOnTarget: readonly CardEffect[]): Verdict;
  /** Checks a caster's configuration and returns it in the card's own shape. */
  validateConfig(config: unknown): Verdict<Config>;
  /** For a card whose effect holds state (Whoops!'s strokes): checks a state to be saved. */
  validateState?(state: unknown): Verdict<unknown>;
}

/** What the Vending Machine sells a card for, under these settings. */
export function basePrice(rules: CardRules, settings: Settings): Hundredths {
  const price = settings.economy[rules.priceKey];
  if (!Number.isSafeInteger(price) || price! <= 0) throw new Error(`card ${rules.key}'s price, economy "${rules.priceKey}", is ${price}`);
  return price!;
}

/** One of the instance's economy numbers, which an instance must hold (instanceProblems). */
export function economyOf(settings: Settings, key: string): number {
  const n = settings.economy[key];
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`economy "${key}" is not set`);
  return n;
}

export const ok = <T>(value: T): Verdict<T> => ({ ok: true, value });
export const refuse = (why: string): Verdict<never> => ({ ok: false, why });

/**
 * A card played on a target, decided by its own rules: whether it lands there given the
 * effects already on it, whether the caster's configuration is one it accepts, and what it
 * costs from the wallet. The SQL function that writes the play holds what it can again.
 *
 * The price is read from the post as it stands when the play is decided. A post edited longer
 * or shorter in the moment before the play lands costs the caster what it would have a moment
 * earlier: the caster pays what they were shown, and nobody else is touched.
 */
export function decidePlay(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown): Verdict<{ price: Hundredths; config: unknown }> {
  const lands = rules.canApply(target, effects);
  if (!lands.ok) return lands;
  const checked = rules.validateConfig(config);
  if (!checked.ok) return checked;
  const price = rules.playPrice(settings, target, checked.value);
  if (!Number.isSafeInteger(price) || price < 0) throw new Error(`card ${rules.key} priced a play at ${price}`);
  return ok({ price, config: checked.value });
}

/** What every card holds to unless it says otherwise: it lands on a post, once per post. */
export function landsOncePerPost(key: string, target: CardTarget, effects: readonly CardEffect[]): Verdict {
  if (target.kind !== 'post') return refuse('a card lands on a post');
  if (effects.some((e) => e.card === key)) return refuse('this post already carries that card');
  return ok(undefined);
}

/** A color as a post's [color] tag reads one (engine/bbcode/parse.ts), surrounding spaces aside. */
export function color(value: unknown): string | null {
  return typeof value === 'string' ? safeColor(value.trim()) : null;
}
