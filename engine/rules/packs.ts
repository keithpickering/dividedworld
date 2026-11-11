/**
 * Packs and the machine's slots, as an instance gives them (docs/plans/2026-11-04-booster-packs-design.md): a pack is a list
 * of pulls, each a set of weights over rarities, and a slot is one place in the machine's grid, holding a card or a pack at a
 * price. Pure: the fake backend rolls with `rollPack`, the SQL rolls on its own, and the screens show `packOdds`.
 */
import { RARITIES, withheld, type CardRules, type Rarity } from './cards.ts';
import type { Settings } from './types.ts';

/** One pull of a pack: a weight for each rarity it can roll, positive whole numbers. */
export interface Pull { readonly weights: Readonly<Partial<Record<Rarity, number>>> }

/** A pack an instance sells: its pulls in reveal order (the last is the hit pull), and cards it leaves out. */
export interface PackRules { readonly key: string; readonly pulls: readonly Pull[]; readonly leaves?: readonly string[] }

/** A slot the instance seeds. `price` is in hundredths of an orb. */
export interface SlotSeed {
  readonly item: { readonly card: string } | { readonly pack: string };
  readonly availability: 'onSale' | 'soldOut' | 'hidden';
  readonly price: number;
}

/**
 * The machine-move numbers every instance starts from (the Boss's three moves on the machine): the most pulls a move may
 * name, the longest a move runs in days, how far a reprice may go in percent of the price, and how long a flash sale lasts
 * in hours. An instance spreads these into `Settings.economy` and may retune them.
 */
export const MACHINE_DEFAULTS: Readonly<Record<string, number>> = Object.freeze({
  'machine.pullMost': 2,
  'machine.moveDaysMost': 7,
  'machine.repriceLeast': 50,
  'machine.repriceMost': 200,
  'machine.flashHoursLeast': 24,
  'machine.flashHoursMost': 48,
});

/** One rarity a pull can roll: its chance of the pull, and the cards it can hand out with each one's chance of the pull. */
export interface RarityOdds {
  readonly rarity: Rarity;
  readonly chance: number;
  readonly cards: readonly { readonly card: string; readonly chance: number }[];
}

/** The cards a pack can hand out at a rarity: the instance's, in its order, less what the pack leaves out and what the instance withholds (a card that writes, with no old voice); the SQL roll leaves the same ones out. */
function eligible(pack: PackRules, cards: readonly CardRules[], settings: Pick<Settings, 'oldVoice'>, rarity: Rarity): string[] {
  const left = new Set(pack.leaves ?? []);
  return cards.filter((c) => c.rarity === rarity && !left.has(c.key) && !withheld(c, settings)).map((c) => c.key);
}

/** The rarities of a pull that have a card to give, with their weights, in rarity order. A rarity with none is not rolled. */
function rollable(pack: PackRules, cards: readonly CardRules[], settings: Pick<Settings, 'oldVoice'>, pull: Pull): { rarity: Rarity; weight: number; keys: string[] }[] {
  const out: { rarity: Rarity; weight: number; keys: string[] }[] = [];
  for (const rarity of RARITIES) {
    const weight = pull.weights[rarity];
    if (weight === undefined || !(weight > 0)) continue;
    const keys = eligible(pack, cards, settings, rarity);
    if (keys.length) out.push({ rarity, weight, keys });
  }
  return out;
}

/** For each pull of a pack, each rarity's chance and the eligible cards with their chances. */
export function packOdds(pack: PackRules, cards: readonly CardRules[], settings: Pick<Settings, 'oldVoice'>): RarityOdds[][] {
  return pack.pulls.map((pull) => {
    const rolls = rollable(pack, cards, settings, pull);
    const total = rolls.reduce((sum, r) => sum + r.weight, 0);
    return rolls.map((r) => {
      const chance = r.weight / total;
      return { rarity: r.rarity, chance, cards: r.keys.map((card) => ({ card, chance: chance / r.keys.length })) };
    });
  });
}

/**
 * One card key per pull, in pull order. Each pull takes two draws from `random` (a number from 0 up to, not including, 1): the
 * first picks the rarity by weight, the second a card of it, evenly.
 */
export function rollPack(pack: PackRules, cards: readonly CardRules[], settings: Pick<Settings, 'oldVoice'>, random: () => number): string[] {
  return pack.pulls.map((pull, i) => {
    const rolls = rollable(pack, cards, settings, pull);
    if (!rolls.length) throw new Error(`pack ${pack.key}'s pull ${i + 1} has no card to give`);
    const total = rolls.reduce((sum, r) => sum + r.weight, 0);
    const at = random() * total;
    let acc = 0;
    let chosen = rolls[rolls.length - 1]!;
    for (const r of rolls) {
      acc += r.weight;
      if (at < acc) { chosen = r; break; }
    }
    return chosen.keys[Math.min(chosen.keys.length - 1, Math.floor(random() * chosen.keys.length))]!;
  });
}

/** What the machine sells a card for: its slot's price. Throws when the machine has no slot for it. */
export function cardPrice(machine: readonly SlotSeed[], card: string): number {
  const slot = machine.find((s) => 'card' in s.item && s.item.card === card);
  if (!slot) throw new Error(`the machine has no slot for card ${card}`);
  return slot.price;
}
