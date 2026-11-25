/**
 * Take the Fall (Sweet, uncommon, a Move only ever cast face up): cast on another character's post, it makes the next filing of a Mod Bot's visit to that post land its warn
 * points, and any ban they bring, on the character that played this card instead of the post's author (docs/plans/2026-11-11-card-notes-design.md, section 2, and its Part 5 plan). The post keeps its notice. One fits on a post, for good:
 * it waits, with no time up, until a filing spends it, or an admin ends it. It holds nobody meanwhile, and the character that took the fall can appeal the filing.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const takeTheFall: CardRules<Record<string, never>> = {
  key: 'take-the-fall',
  name: 'Take the Fall',
  alignment: 'sweet',
  rarity: 'uncommon',
  discipline: { kind: 'fall' },
  seen: (p) => `${who(p)} stepped up to take the fall for this post, ${p.ago}: the next time a Mod Bot files on it, the filing lands on them instead of its author.`,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(takeTheFall, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
