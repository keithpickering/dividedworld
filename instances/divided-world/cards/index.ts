/** Divided World's first two cards. Autocorrect, the Minus World signature, is next (design, section 11). */
import type { CardRules } from '../../../engine/rules/cards.ts';
import { stickAround } from './stick-around.ts';
import { whoops } from './whoops.ts';

export const cards: readonly CardRules[] = Object.freeze([stickAround as CardRules, whoops as CardRules]);
