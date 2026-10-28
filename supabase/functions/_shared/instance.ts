/**
 * The composition root's one choice: which instance this deployment runs. This file and the
 * functions beside it are the only place the engine and an instance meet ("KayfaBB never knows
 * which instance it runs"); tools/check-engine-boundary.mjs holds engine/ to never importing it.
 * KAYFABB_PROFILE picks the profile: `playtest` for the playtest's shorter season and Turn
 * cooldown, nothing for the defaults; any other value is refused rather than guessed.
 */
import { instance as dividedWorld, playtestInstance } from '../../../instances/divided-world/index.ts';
import type { Instance } from '../../../engine/rules/types.ts';

export const instance: Instance = dividedWorld;

export function chooseInstance(profile: string | undefined): Instance {
  if (profile === undefined || profile === '') return dividedWorld;
  if (profile === 'playtest') return playtestInstance;
  throw new Error(`KAYFABB_PROFILE is "${profile}"; the profiles are "playtest" and none`);
}
