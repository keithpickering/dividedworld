/**
 * The words more than one card's screen entry says, read from the rules and never restated: a Move's face-down sentence, a span, what a
 * Gimmick adds, a payout's share, a quadrant's or a class's name, a price. Each card's own entry is `ui/cards/<key>/ui.ts`.
 */
import { QUADRANTS, type Settings } from '../../../../engine/rules/types.ts';
import type { GimmickEffect } from '../../../../engine/rules/cards.ts';
import { shareWords } from '../../../../engine/ui/copy-words.ts';
import { classes } from '../../classes/index.ts';
import { quadrantLabels } from '../quadrant-labels.ts';
import { mooch } from '../../cards/mooch.ts';
import { toll } from '../../cards/toll.ts';
import { fourDChess } from '../../cards/4d-chess.ts';
import { whoopeeCushion } from '../../cards/whoopee-cushion.ts';

/**
 * The sentence a Move's words gain on setting it (the face-down Moves design, section 3): set face down on your own post, it springs on the
 * next quote of that post and lands, at no further cost, on what quoted it, at the card's own reach (the quoting post, its character, its thread).
 */
export const setMoveWords = (lands: string) => `You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on ${lands} at no further cost, using up the card.`;

/** A span in words: "a week", "3 days". */
export const spanWords = (s: { readonly unit: string; readonly count: number }) => (s.unit === 'day' && s.count === 7 ? 'a week' : s.count === 1 ? `${s.unit === 'hour' ? 'an' : 'a'} ${s.unit}` : `${s.count} ${s.unit}s`);

/** How heavily a watch weighs a pick, from the rules' weight and never restated: "double" only while the weight is 2. */
export function weighted(rules: { readonly discipline?: { readonly kind: string; readonly weight?: number } }): string {
  const weight = rules.discipline?.weight ?? 1;
  return weight === 2 ? 'double' : `${weight} times over`;
}

/** What a flat Earn Gimmick pays on top of a vote, as the end of a sentence, read from the card's own rules: "half a vote more", "three quarters of a vote more", "a vote more". A card with no flat earn is a mistake in these words, so it throws. */
export const earnWords = (c: { readonly gimmick?: GimmickEffect }) => {
  if (c.gimmick?.kind !== 'earn' || !('flat' in c.gimmick)) throw new Error('card has no flat earn gimmick');
  return `${shareWords(c.gimmick.flat)} more`;
};

/** Whose votes a timed earn card counts, said by every card that earns for a span: the settlement pays per vote, and a player's first reaction to the post decides whether theirs counts. */
export const FIRST_REACTORS = 'It counts votes from players who first react to a post while it is up.';

/** What a Price Gimmick adds to a cast, read from the card's own rules: "0.25". */
export const priceAdd = (c: { readonly gimmick?: GimmickEffect }) => {
  if (c.gimmick?.kind !== 'price') throw new Error('card has no price gimmick');
  return orbs(c.gimmick.add);
};

/**
 * What a payout card pays, in words, read from its own rules and never restated: Mooch's skim, Toll's ride Gimmick and 4D Chess's ride
 * outcome ("a tenth of a vote", "half a vote", "a vote"). A card that has not that payout is a mistake in these words, so it throws.
 */
export const skimShare = () => {
  if (mooch.skim === undefined) throw new Error('Mooch has no skim');
  return shareWords(mooch.skim.share);
};
export const tollShare = () => {
  if (toll.gimmick?.kind !== 'ride') throw new Error('Toll has no ride gimmick');
  return shareWords(toll.gimmick.share);
};
export const rideShare = () => {
  if (fourDChess.trap?.outcome?.kind !== 'ride') throw new Error('4D Chess has no ride outcome');
  return shareWords(fourDChess.trap.outcome.share);
};
export const cushionShare = () => {
  if (whoopeeCushion.trap?.outcome?.kind !== 'ride') throw new Error('Whoopee Cushion has no ride outcome');
  return shareWords(whoopeeCushion.trap.outcome.share);
};

/** A quadrant a play named, in the instance's own word for it; "reactions" where the play names none the card can read. */
export const quadrantOf = (config: Readonly<Record<string, unknown>> | undefined): string | undefined => {
  const q = config?.quadrant;
  return typeof q === 'string' && q in quadrantLabels ? quadrantLabels[q as keyof typeof quadrantLabels] : undefined;
};

/** The four quadrants' names in the picker's order, as a sentence's list: "Hype, Heat, Calm or Groan". */
export const quadrantNames = () => {
  const names = QUADRANTS.map((q) => quadrantLabels[q]);
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
};

/** The class a play named, with its article ("a Heel", "an Aura Farmer"); undefined where it names none the instance has. */
export const classWords = (config: Readonly<Record<string, unknown>> | undefined): string | undefined => {
  const name = classes.find((c) => c.key === config?.class)?.name;
  return name === undefined ? undefined : `${/^[aeiou]/iu.test(name) ? 'an' : 'a'} ${name}`;
};

/** The days a set card stays face down, as the machine says it. */
export const setLastsWords = (settings: Settings) => `${settings.setLasts.count} ${settings.setLasts.unit}${settings.setLasts.count === 1 ? '' : 's'}`;

/** A price of a whole number of hundredths, as the shop says it: "1.00". */
export const orbs = (hundredths: number) => (hundredths / 100).toFixed(2);

/** A list in words: "0.10, 0.25, 0.50 and 1.00". */
export const listWords = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join(''));
