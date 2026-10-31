/**
 * Divided World's classes: the three core playstyles, the Jabroni and the Technician. A season
 * may add more. This list's order is the order every screen draws the classes in: the Turn's
 * carousel, New character, the reveal and Rankings.
 */
import type { ClassRules } from '../../../engine/rules/types.ts';
import { face } from './face.ts';
import { heel } from './heel.ts';
import { jabroni } from './jabroni.ts';
import { technician } from './technician.ts';
import { lurker } from './lurker.ts';

export const classes: readonly ClassRules[] = Object.freeze([face, heel, jabroni, technician, lurker]);
