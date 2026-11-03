/**
 * Divided World's cards: two Casts (Stick Around, Whoops!), and the card mechanic's first plays (Trap Card, Force Field, Bluff; the
 * card mechanic's design, section 6), and the first cards beyond a post: Glitter Bomb on a character and Main Event on a thread (section 8).
 * Feelin' Fab, the Face's rainbow, is the first card of the onboarding (docs/plans/2026-11-02-onboarding-design.md, section 5).
 * Autocorrect, the Minus World signature, is next (design, section 11).
 */
import type { CardRules } from '../../../engine/rules/cards.ts';
import { bluff } from './bluff.ts';
import { feelinFab } from './feelin-fab.ts';
import { forceField } from './force-field.ts';
import { glitterBomb } from './glitter-bomb.ts';
import { mainEvent } from './main-event.ts';
import { stickAround } from './stick-around.ts';
import { trapCard } from './trap-card.ts';
import { whoops } from './whoops.ts';

export const cards: readonly CardRules[] = Object.freeze([stickAround as CardRules, whoops as CardRules, trapCard as CardRules, forceField as CardRules, bluff as CardRules, glitterBomb as CardRules, mainEvent as CardRules, feelinFab as CardRules]);
