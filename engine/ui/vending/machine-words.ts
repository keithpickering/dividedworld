/**
 * What the Vending Machine says in plain words about what is on it: a pack's odds, pull by pull; why a slot is sold out; and each Boss move in
 * force on a slot (docs/plans/2026-11-04-booster-packs-design.md, sections 5 and 6). The machine is glass, and the glass speaks plainly and
 * truly: these words are built from the move's kind and demand in the engine's catalogs (engine/system/demands.ts) and the numbers the
 * server returned, never from anything the Boss wrote. Pure: nothing here reads a clock or a database (`now` is given).
 */
import { RARITIES, type CardRules, type Rarity } from '../../rules/cards.ts';
import { packOdds, type PackRules } from '../../rules/packs.ts';
import { demandKind } from '../../system/demands.ts';
import type { SlotMove } from '../data/api.ts';
import { dayAndTime } from '../characters/format.ts';
import { rarityName, orbs } from '../cards/faces.ts';
import { shortDate } from '../postbit/dates.ts';

/** A chance as the odds table says it: "85%", "12.5%". Never rounded to a whole number that is not the chance, and a chance above 0 never reads "0%": "<0.1%". */
export function percent(chance: number): string {
  if (chance > 0 && Math.round(chance * 1000) === 0) return '<0.1%';
  const p = Math.round(chance * 1000) / 10;
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

/** One row of an odds table: a rarity's chance in a pull, or a card's in the hit pull. */
export interface OddsRow {
  readonly key: string;
  readonly label: string;
  readonly rarity: Rarity;
  readonly chance: number;
}

/** A block of an odds table: the pulls it covers ("Cards 1 to 4, each") and what each of them can give. */
export interface OddsGroup {
  readonly heading: string;
  readonly rows: readonly OddsRow[];
}

/**
 * A pack's odds as a plain table: the pulls before the last that roll the same weights are one block ("Cards 1 to 4, each"), each row a
 * rarity and its chance; the last pull is the hit and is its own block, each row a card and its chance of that pull.
 */
export function oddsGroups(pack: PackRules, cards: readonly CardRules[]): OddsGroup[] {
  const pulls = packOdds(pack, cards);
  if (pulls.length === 0) return [];
  const nameOf = (key: string) => cards.find((c) => c.key === key)?.name ?? key;
  const rarityOf = (key: string): Rarity => cards.find((c) => c.key === key)?.rarity ?? 'common';
  const groups: OddsGroup[] = [];
  const same = (a: number, b: number) => JSON.stringify(pulls[a]!.map((r) => [r.rarity, r.chance])) === JSON.stringify(pulls[b]!.map((r) => [r.rarity, r.chance]));
  let from = 0;
  while (from < pulls.length - 1) {
    let to = from;
    while (to + 1 < pulls.length - 1 && same(from, to + 1)) to++;
    const first = from + 1;
    const last = to + 1;
    groups.push({
      heading: first === last ? `Card ${first}` : `Cards ${first} to ${last}, each`,
      rows: pulls[from]!.map((r) => ({ key: r.rarity, label: rarityName(r.rarity), rarity: r.rarity, chance: r.chance })),
    });
    from = to + 1;
  }
  const hit = pulls.length;
  groups.push({
    heading: hit === 1 ? 'Card 1, the hit' : `Card ${hit}, the hit`,
    rows: pulls[hit - 1]!.flatMap((r) => r.cards.map((c) => ({ key: c.card, label: nameOf(c.card), rarity: rarityOf(c.card), chance: c.chance }))),
  });
  return groups;
}

/** Every card key a pack can give. */
export function packCards(pack: PackRules, cards: readonly CardRules[]): string[] {
  return [...new Set(packOdds(pack, cards).flatMap((pull) => pull.flatMap((r) => r.cards.map((c) => c.card))))];
}

/** "Main Event isn't sold on its own." for the cards a pack can give that the machine is not selling now; null when it sells them all. */
export function unsoldOnTheirOwn(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return names.length === 1 ? `${list} isn't sold on its own.` : `${list} aren't sold on their own.`;
}

/** Why a slot is sold out, as a clause: "pulled by the Boss until Nov 9" for a Pull, "sold out" for an admin's choice. */
export function soldWhy(move: SlotMove | null): string {
  if (move?.kind === 'pullSlot') return `pulled by the Boss${move.ends ? ` until ${shortDate(move.ends)}` : ''}`;
  return 'sold out';
}

/** What a slot's button says of a move that changed its price or opened it, in the order a name carries it: ", marked up from 1.50". */
export function priceNote(move: SlotMove | null, price: number): string {
  if (!move) return '';
  if (move.kind === 'repriceSlot' && move.was !== price) return `, marked ${price > move.was ? 'up' : 'down'} from ${orbs(move.was)}`;
  if (move.kind === 'flashSale') return `, flash sale${move.ends ? ` until ${dayAndTime(move.ends)}` : ''}`;
  return '';
}

export interface MoveContext {
  readonly name: string;
  /** The slot's price now, in hundredths. */
  readonly price: number;
  /** The name of the board the move's demand is about, where it is known. */
  readonly board: string | null;
  /** Whether a pack on sale can still hand out the card (a Pull leaves it there: the plan's "packs are the floor"). */
  readonly inPacks: boolean;
  /** The name of the packs it comes in, where `inPacks` is true ("Boosters"). */
  readonly packsWord: string;
}

/** The move in force on a slot as two clauses of plain words, the first the one the page stresses: "Whoops! is pulled" and "until Nov 9, or sooner once ...". */
export function moveWords(move: SlotMove, c: MoveContext): { readonly lead: string; readonly rest: string } {
  const ends = move.ends ? shortDate(move.ends) : '';
  const demand = move.demand ? demandKind(move.demand.kind) : undefined;
  /* "12 different characters to post on this board", with the board's name where it is known. */
  const asks = demand && move.demand ? demand.needs(move.demand.params).replace(/\bon this board\b/u, c.board ? `in ${c.board}` : 'on its board') : null;
  const counted = move.progress && move.progress.checkedAt !== null && !move.progress.error ? ` (${move.progress.done} of ${move.progress.of} so far)` : '';
  /* A demand is the way out, and a move that carries one ends early when it is met. */
  const sooner = (until: string) => (asks ? `${until ? `${until}, or sooner if its demand is met` : 'Ends if its demand is met'}: ${asks}${counted}.` : until ? `${until}.` : '');
  if (move.kind === 'pullSlot') {
    return { lead: `${c.name} is pulled`, rest: `${sooner(ends ? `until ${ends}` : '')}${c.inPacks ? ` It still comes in ${c.packsWord}.` : ''}`.trim() };
  }
  if (move.kind === 'repriceSlot') {
    const up = c.price > move.was;
    const until = ends ? `until ${ends}` : '';
    const tail = up ? sooner(until) : until ? `${until}.` : '.';
    return { lead: `${c.name} is marked ${up ? 'up' : 'down'}`, rest: `from ${orbs(move.was)} to ${orbs(c.price)}${tail === '.' ? '.' : ` ${tail}`}` };
  }
  return { lead: `${c.name} is on flash sale`, rest: `at ${orbs(c.price)}${move.ends ? ` until ${dayAndTime(move.ends)}` : ''}.` };
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** A count as a sentence says it: "five". */
export const countWord = (n: number): string => WORDS[n] ?? String(n);

/** The least rare a pack's last pull can give ("uncommon", in "the last one at least uncommon"); null where it has no pulls. */
export function hitLeast(pack: PackRules, cards: readonly CardRules[]): Rarity | null {
  const pulls = packOdds(pack, cards);
  const hit = pulls[pulls.length - 1];
  if (!hit || hit.length === 0) return null;
  return hit.map((r) => r.rarity).sort((a, b) => RARITIES.indexOf(a) - RARITIES.indexOf(b))[0]!;
}

/** What a pack's selection says about opening it: "Five cards, the last one at least uncommon. It opens as soon as you buy it." */
export function packLine(pack: PackRules, cards: readonly CardRules[]): string {
  const n = pack.pulls.length;
  const least = hitLeast(pack, cards);
  const head = `${countWord(n).charAt(0).toUpperCase()}${countWord(n).slice(1)} cards`;
  return `${head}${least && least !== 'common' ? `, the last one at least ${least}` : ''}. It opens as soon as you buy it.`;
}
