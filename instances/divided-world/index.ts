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
]);

export const instance: Instance = Object.freeze({ key: 'divided-world', name: 'Divided World', classes, cards, reactions, settings: defaults, boards });

/** The same instance on the playtest's shorter season and Turn cooldown. */
export const playtestInstance: Instance = Object.freeze({ ...instance, settings: playtest });
