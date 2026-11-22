/** Time Machine's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { timeMachine, TIME_MACHINE_LASTS } from '../../../cards/time-machine.ts';
import timeMachineCanvas from './art.webp?url';
import timeMachineMark from './mark.svg?url';
import timeMachineArt from './art.json';
import { spanWords } from '../words.ts';
import { readOut } from './readout.ts';

/* Loaded the first time a post wears it, as every card's effect is (engine/ui/cards/Effects.tsx draws it inside a Suspense). */
const TimeMachineEffect = lazy(() => import('./Effect.tsx').then((m) => ({ default: m.TimeMachineEffect })));

/*
 * Time Machine (docs/plans/2026-11-21-time-machine-design.md): Pepperoni's color. The post shows as it was at an earlier point its player picked
 * from its History, under tape (Effect.tsx). The engine draws the earlier words and hides the plays the point predates; this entry says the card.
 */
export const ui: CardUi = {
  key: 'time-machine',
  Effect: TimeMachineEffect,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: timeMachineCanvas, mark: timeMachineMark, credit: timeMachineArt.credit, tagline: 'Go back to better days.' },
  summary: 'Played on a post. For 3 days it shows as it was at an earlier point you pick, and no card up to rare can be played on it.',
  status: 'Showing an earlier version',
  hint: 'This post is showing an earlier version. Its History has the rest.',
  describe: () =>
    `A Pepperoni card, ${timeMachine.rarity}. Played on a post, it shows the post as it was at an earlier point you pick from its History, for ${spanWords(TIME_MACHINE_LASTS)}. Cards played on the post after that point are hidden, not ended, and show again when it ends. While it is up, no card up to ${timeMachine.rewind!.upTo} can be played on the post, and nothing set face down on it springs. The author can still edit, and History lists the edit, but the post keeps showing the earlier version until the Time Machine ends. It can only be played face up. It costs nothing more to play than its price at the machine.`,
  logPlay: (_config, recorded) => (recorded.rewindsTo === undefined ? undefined : `That post shows as it was on ${readOut(recorded.rewindsTo)} until it ends.`),
};
