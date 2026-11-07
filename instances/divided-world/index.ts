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
import { system } from './system/index.ts';

const boards = deepFreeze([
  { slug: 'general', name: 'General', description: 'Anything and everything. The staff are watching.' },
  // Only the staff and the game post here: the Boss's arrivals and farewells, the characters' Promos (the board look design, section 7).
  { slug: 'announcements', name: 'Staff Announcements', description: 'Where the staff post. Reply by spinning a thread.', system: true },
]);

/** The System's words, in its own voice. */
const copy = deepFreeze({
  announcementsThreadTitle: 'Season {season}: Promos',
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

/**
 * The developer persona, who writes the Updates page (the alerts design, section 3): Gabe, carried from Minus World, "who ostensibly invented
 * the game". His tagline is instance content and travels in the seed as his profile title; `avatar` is the key of his picture in
 * ui/avatars (InstanceUi.avatars). The voice is the admins' to write: it is never a model's, and what it says is always true.
 */
const developer = deepFreeze({ name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' });

/** The pips a postbit draws beside a rank: the default for now; more come with the gacha and trophies. */
const pipStyles = deepFreeze([
  { key: 'default', name: 'Default', full: 'pips/default-full.svg', empty: 'pips/default-empty.svg' },
]);

export const instance: Instance = Object.freeze({ key: 'divided-world', name: 'Divided World', copy, classes, cards, reactions, settings: defaults, boards, ranks, pipStyles, system, developer });

/** The same instance on the playtest's shorter season and Turn cooldown. */
export const playtestInstance: Instance = Object.freeze({ ...instance, settings: playtest });
