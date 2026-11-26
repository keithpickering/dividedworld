/**
 * The clock the can's lid watchers keep (e2e/origin-effects.spec.ts, e2e/steel-chair.spec.ts). The lid ages on the effect's own clock,
 * which a frame moves by at most MOST_STEPS of body.ts's STEP (Effect.tsx), so a watcher on a slow runner counts the same time the lid
 * does, never wall time. One list, so the two watchers cannot drift apart.
 */
import { MOST_STEPS, STEP } from '../instances/divided-world/ui/steel-chair/body.ts';
import { LID_SECONDS } from '../instances/divided-world/ui/steel-chair/lid.ts';

/** The most one frame moves the effect's clock, in seconds. */
export const FRAME_MOST_S = MOST_STEPS * STEP;
/** How long a lid's arc lasts on that clock. */
export { LID_SECONDS };
/** How much of that clock a can is given to throw its lid before a watcher gives up: a lid flies as the can first lands, well inside it. */
export const NO_LID_BY_S = 5;
