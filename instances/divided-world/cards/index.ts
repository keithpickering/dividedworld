/**
 * Divided World's cards: two Casts (Stick Around, Whoops!), and the card mechanic's first plays (Trap Card, Force Field, Bluff; the
 * card mechanic's design, section 6). Autocorrect, the Minus World signature, is next (design, section 11).
 */
import type { CardRules } from '../../../engine/rules/cards.ts';
import { bluff } from './bluff.ts';
import { forceField } from './force-field.ts';
import { stickAround } from './stick-around.ts';
import { trapCard } from './trap-card.ts';
import { whoops } from './whoops.ts';

export const cards: readonly CardRules[] = Object.freeze([stickAround as CardRules, whoops as CardRules, trapCard as CardRules, forceField as CardRules, bluff as CardRules]);
