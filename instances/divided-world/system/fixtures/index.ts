/**
 * The three placeholder Bosses, kept as test fixtures (the FanGaME design, section 6). They are never in the roster; tests
 * that need several contrasting Bosses build a roster from them.
 */
import { deepFreeze } from '../../../../engine/rules/instance.ts';
import { theClerk } from './the-clerk.ts';
import { hypeMan } from './hype-man.ts';
import { sighbot } from './sighbot.ts';
import { placeholderMonitor } from '../personas/placeholder-monitor.ts';
import type { Instance } from '../../../../engine/rules/types.ts';

export const placeholderBosses = deepFreeze([theClerk, hypeMan, sighbot]);

/**
 * The instance with the placeholder roster in place of the real one: the three placeholder Bosses and the placeholder
 * Mod Bot, the hype man the first Boss. It exists for the test worlds that still need those Bosses after FanGaME became
 * the only Boss, so their keys and voices stay the ones their tests were written against. The instance's type is kept.
 */
export function placeholderWorld<T extends Instance>(instance: T): T {
  return { ...instance, system: { ...instance.system, roster: [...placeholderBosses, placeholderMonitor], firstBoss: 'placeholder-hype-man' } };
}
