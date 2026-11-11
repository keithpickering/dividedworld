/**
 * The three placeholder Bosses, kept as test fixtures (the FanGaME design, section 6). They are never in the roster; tests
 * that need several contrasting Bosses build a roster from them.
 */
import { deepFreeze } from '../../../../engine/rules/instance.ts';
import { theClerk } from './the-clerk.ts';
import { hypeMan } from './hype-man.ts';
import { sighbot } from './sighbot.ts';

export const placeholderBosses = deepFreeze([theClerk, hypeMan, sighbot]);
