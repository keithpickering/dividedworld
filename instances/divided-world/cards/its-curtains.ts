/**
 * It's Curtains (Pepperoni, uncommon, a Cast on a post): a false reveal. A post is covered by a curtain in a fabric the caster chose,
 * and a reader who presses it sees a drumroll, a whoosh and a tada, then the next curtain behind it, up to three, each costing more to
 * play than the last (docs/plans/2026-11-23-its-curtains-design.md, sections 2.5 to 2.7; the plan's Task 4). The curtains are drawn by the
 * screens; this file owns what a play buys, what a configuration may hold, and where the play lands.
 *
 * - **Stacking** (2.5): `stack` is 3, so a post carries up to three of it, each its own curtain, latest played outermost.
 * - **Price** (2.6): the first curtain on a post adds nothing to play, the second adds `itsCurtains.secondAdd` and the third
 *   `itsCurtains.thirdAdd`, counting the curtains already on the post that are still up. Off a post it costs nothing more.
 * - **Color** (2.7): a fixed list of fabrics, each with its dark, mid and light shades. A configuration names one; a missing one is red,
 *   and anything else is refused, so no hex code or free picker gets in.
 */
import { landsOn, ok, refuse, economyOf, isLive, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

/** The fabrics a curtain can be, each with its dark, mid and light shades set by hand (2.7). */
export const FABRICS = {
  red: { name: 'Red', dark: '#af0000', mid: '#ee0000', light: '#f73434' },
  'royal-blue': { name: 'Royal Blue', dark: '#0a1f6b', mid: '#1f3fbf', light: '#4a6bef' },
  purple: { name: 'Purple', dark: '#3b0a5c', mid: '#6a1b9a', light: '#9c4dcc' },
  emerald: { name: 'Emerald', dark: '#04402a', mid: '#0b7a4b', light: '#2fb37a' },
  gold: { name: 'Gold', dark: '#7a5a00', mid: '#c9a000', light: '#f2d24a' },
  black: { name: 'Black', dark: '#050505', mid: '#1c1c1c', light: '#3a3a3a' },
} as const;
export type Fabric = keyof typeof FABRICS;

const isFabric = (fabric: unknown): fabric is Fabric => typeof fabric === 'string' && Object.prototype.hasOwnProperty.call(FABRICS, fabric);

export const itsCurtains: CardRules<{ fabric: Fabric }> = {
  key: 'its-curtains',
  name: "It's Curtains",
  alignment: 'pepperoni',
  rarity: 'uncommon',
  reaches: ['post'],
  stack: 3,
  /** Its effect is drawn on the post, so each curtain counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  reads: [
    { key: 'itsCurtains.secondAdd', whole: true, min: 0 },
    { key: 'itsCurtains.thirdAdd', whole: true, min: 0 },
  ],
  staffConfigs: (Object.keys(FABRICS) as Fabric[]).map((fabric) => ({ fabric })),
  seen: (p) => `${who(p)} hid this post behind a curtain, ${p.ago}: each reader opens it with a press to see the post, and its author.`,
  playPrice: (settings, target, _config, effects) => {
    if (target.reach !== 'post') return 0;
    /* playPrice is given no clock, so an ended curtain is read against the wall clock, as Laugh Track's price reads it. */
    const up = effects.filter((e) => (e.reach === undefined || e.reach === 'post') && e.card === 'its-curtains' && isLive(e)).length;
    if (up === 0) return 0;
    return economyOf(settings, up === 1 ? 'itsCurtains.secondAdd' : 'itsCurtains.thirdAdd');
  },
  canApply: (target, effects, _config, now) => landsOn(itsCurtains, target, effects, now),
  /** The fabric is the caster's; a missing one is red, and anything else is refused. Nothing else is kept. */
  validateConfig: (config) => {
    const fabric = typeof config === 'object' && config !== null ? (config as { fabric?: unknown }).fabric : undefined;
    if (fabric === undefined) return ok({ fabric: 'red' });
    return isFabric(fabric) ? ok({ fabric }) : refuse('the curtain is one of the listed fabrics');
  },
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
