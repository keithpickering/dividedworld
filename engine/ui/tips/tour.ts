/**
 * The HUD tour (docs/plans/2026-11-02-onboarding-design.md, section 7; plan Task 5): three tips, `tour-plate`, `tour-orbs` and `tour-hand`,
 * each "N of 3", pointed at the HUD's character plate, orbs and Hand button. They are one group, so they take turns on the page's one tip
 * budget; a step already seen is skipped by the tips' store, and the numbers stay the step's own, so a reload after step 2 resumes at "3 of 3".
 * The step order is the store's queue order, which is the order the tips register in, and that holds only because the three `useTip` calls sit
 * in this one component, in order; moving one of them to another component would reorder the steps. The HUD says when the tour is `ready`: on
 * a board page, the HUD has an acting character (debuted, not retired; narrower than "the account has a character" because the plate and the
 * hand need it) and the account has seen the welcome. A page load that cannot show it (pacing) tries again on the next, because nothing here
 * marks a step seen.
 */
import type { RefObject } from 'react';
import { TOUR_KEYS } from './keys.ts';
import { useTip } from './Tips.tsx';

export interface TourTargets {
  readonly plate: RefObject<HTMLElement | null>;
  readonly orbs: RefObject<HTMLElement | null>;
  readonly hand: RefObject<HTMLElement | null>;
}

const GROUP = 'tour';

export function useTour(targets: TourTargets, ready: boolean): void {
  const of = TOUR_KEYS.length;
  useTip('tour-plate', targets.plate, { when: ready, group: GROUP, step: { n: 1, of } });
  useTip('tour-orbs', targets.orbs, { when: ready, group: GROUP, step: { n: 2, of } });
  useTip('tour-hand', targets.hand, { when: ready, group: GROUP, step: { n: 3, of } });
}
