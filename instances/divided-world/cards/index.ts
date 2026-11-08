/**
 * Divided World's cards: two Casts (Stick Around, Whoops!), and the card mechanic's first plays (Trap Card, Force Field, Bluff; the
 * card mechanic's design, section 6), and the first cards beyond a post: Glitter Bomb on a character and Main Event on a thread (section 8).
 * Feelin' Fab, the Face's rainbow, is the first card of the onboarding (docs/plans/2026-11-02-onboarding-design.md, section 5).
 * Autocorrect, the Minus World signature and the Jabroni's starter (docs/plans/2026-11-03-autocorrect-design.md).
 * The three Gimmicks, cards set face down that spring on something: Trap Card (a named card cast there), Hall Pass (a Mod Bot's visit)
 * and Bluff (nothing; the face-down Moves design, section 4).
 */
import type { CardRules } from '../../../engine/rules/cards.ts';
import { autocorrect } from './autocorrect.ts';
import { bluff } from './bluff.ts';
import { feelinFab } from './feelin-fab.ts';
import { forceField } from './force-field.ts';
import { glitterBomb } from './glitter-bomb.ts';
import { hallPass } from './hall-pass.ts';
import { mainEvent } from './main-event.ts';
import { stickAround } from './stick-around.ts';
import { trapCard as trapCardBase } from './trap-card.ts';
import { whoops } from './whoops.ts';

const listed: readonly CardRules[] = [stickAround as CardRules, whoops as CardRules, trapCardBase as CardRules, hallPass as CardRules, forceField as CardRules, bluff as CardRules, glitterBomb as CardRules, mainEvent as CardRules, feelinFab as CardRules, autocorrect as CardRules];

/** Trap Card, with the card a persona may name as an enum of the instance's keys: built here so trap-card.ts imports no other card. */
const trapCard = {
  ...trapCardBase,
  staffOptions: {
    prompt: 'Choose the card this Trap Card catches: the first play of it on this post is caught.',
    schema: { type: 'object', properties: { card: { type: 'string', enum: listed.map((c) => c.key) } }, required: ['card'], additionalProperties: false },
  },
} as CardRules;

export const cards: readonly CardRules[] = Object.freeze(listed.map((c) => (c.key === trapCard.key ? trapCard : c)));
