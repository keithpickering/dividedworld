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
import type { ActKind, Alignment, Hundredths } from './types.ts';

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
  /** What the Vending Machine sells it for. */
  readonly basePrice: Hundredths;
  /** What playing it on this target costs from the wallet, on top of the base price already paid. */
  playPrice(target: CardTarget, config: Config): Hundredths;
  canApply(target: CardTarget, effectsOnTarget: readonly CardEffect[]): Verdict;
  /** Checks a caster's configuration and returns it in the card's own shape. */
  validateConfig(config: unknown): Verdict<Config>;
}

export const ok = <T>(value: T): Verdict<T> => ({ ok: true, value });
export const refuse = (why: string): Verdict<never> => ({ ok: false, why });
