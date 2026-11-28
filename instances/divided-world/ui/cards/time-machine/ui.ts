/** Time Machine's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { timeMachine } from '../../../cards/time-machine.ts';
import timeMachineCanvas from './art.webp?url';
import timeMachineMark from './mark.svg?url';
import timeMachineArt from './art.json';
import { spanWords } from '../words.ts';
import { dayAndTime } from '../../../../../engine/ui/characters/format.ts';

/* Loaded the first time a post wears it, as every card's effect is (engine/ui/cards/Effects.tsx draws it inside a Suspense). */
const TimeMachineEffect = lazy(() => import('../../time-machine/Effect.tsx').then((m) => ({ default: m.TimeMachineEffect })));

/*
 * Time Machine (docs/plans/2026-11-21-time-machine-design.md): Pepperoni's color. The post shows as it was at an earlier point its player picked
 * from its History, under tape (Effect.tsx). The engine draws the earlier words and hides the plays the point predates; this entry says the card.
 */
export const ui: CardUi = {
  key: 'time-machine',
  Effect: TimeMachineEffect,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: timeMachineCanvas, mark: timeMachineMark, credit: timeMachineArt.credit, tagline: 'Go back to better days.' },
  summary: `Played on a post. For ${spanWords(timeMachine.lasts!)} it shows as it was at an earlier point you pick, and no card up to ${timeMachine.rewind!.upTo} can be played on it.`,
  status: 'Showing an earlier version',
  hint: 'This post is showing an earlier version. Its History has the rest.',
  describe: () => `Played on a post. For ${spanWords(timeMachine.lasts!)} it shows as it was at an earlier point you pick, and no card up to ${timeMachine.rewind!.upTo} can be played on it.`,
  logPlay: (_config, recorded) => (recorded.rewindsTo === undefined ? undefined : `That post shows as it was on ${dayAndTime(recorded.rewindsTo)} until it ends.`),
};
