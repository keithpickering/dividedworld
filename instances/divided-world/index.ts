/**
 * Divided World, the first KayfaBB instance (dw.gripe), for the MFGG and Minus World
 * community: everything the engine reads from it, through the Instance interface. The
 * composition root (supabase/functions/) is the one place this is imported beside the engine.
 */
import type { Instance } from '../../engine/rules/types.ts';
import { deepFreeze } from '../../engine/rules/instance.ts';
import { cards } from './cards/index.ts';
import { classes } from './classes/index.ts';
import { reactions } from './reactions.ts';
import { defaults, playtest } from './settings.ts';

const boards = deepFreeze([
  { slug: 'general', name: 'General', description: 'Anything and everything. The System is watching.' },
  // Only The System posts here: each night's tally, each season's reveal. The description is the owner's copy to give.
  { slug: 'the-system', name: 'The System', description: 'What The System says. Reply by spinning a thread.', system: true },
]);

/** The System's words, in its own voice. */
const copy = deepFreeze({
  turnsThreadTitle: 'Season {season}: Who Turned',
  revealTitle: 'Season {season}: The System Remembers Everything',
  revealBody: 'Every mask, every class, every Turn, the quiet ones too. Who wore them, The System keeps to itself.',
});

/** A 2003 member rank from the settled season standing. The names are the owner's placeholders, and the thresholds are the owner's to set. */
const ranks = deepFreeze([
  { name: 'Jobber', from: 0 },
  { name: 'Enhancement Talent', from: 100 },
  { name: 'Midcarder', from: 300 },
  { name: 'Main Eventer', from: 600 },
  { name: 'Headliner', from: 1000 },
  { name: 'Legend', from: 2000 },
]);

/** The pips a postbit draws beside a rank: the default for now; more come with the gacha and trophies. */
const pipStyles = deepFreeze([
  { key: 'default', name: 'Default', full: 'pips/default-full.svg', empty: 'pips/default-empty.svg' },
]);

export const instance: Instance = Object.freeze({ key: 'divided-world', name: 'Divided World', copy, classes, cards, reactions, settings: defaults, boards, ranks, pipStyles });

/** The same instance on the playtest's shorter season and Turn cooldown. */
export const playtestInstance: Instance = Object.freeze({ ...instance, settings: playtest });
