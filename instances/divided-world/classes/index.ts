/** Divided World's classes: the three core playstyles and the Jabroni. A season may add more. */
import type { ClassRules } from '../../../engine/rules/types.ts';
import { face } from './face.ts';
import { heel } from './heel.ts';
import { lurker } from './lurker.ts';
import { jabroni } from './jabroni.ts';

export const classes: readonly ClassRules[] = Object.freeze([face, heel, lurker, jabroni]);
