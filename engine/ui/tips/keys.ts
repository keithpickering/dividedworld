/**
 * The tips the engine knows (docs/plans/2026-11-02-onboarding-design.md, section 7), by the key the account remembers a
 * tip seen by (`Preferences.tipsSeen`). The engine owns the list because it owns where each tip waits for its real thing;
 * an instance owns every word (`InstanceUi.onboarding.tips`), and `instanceUiProblems` (problems.ts) refuses an instance
 * that misses a key or names one the engine does not have.
 *
 * - `tour-plate`, `tour-orbs`, `tour-hand`: the HUD tour's three steps (Task 5), on what is always on screen.
 * - `grid`: the reaction grid, the first time a picker opens.
 * - `ghost`: the ghost fill, the first time the orbs show an estimate.
 * - `shine`: the first shiny post in view on a phone that can tilt (engine/ui/shine/loop.ts), with an action: the button that turns tilt on.
 * - `first-card`: the first card callout a player ever sees (`engine/ui/cards/Callout.tsx`); its line is added to that callout.
 */
export const TIP_KEYS = ['tour-plate', 'tour-orbs', 'tour-hand', 'grid', 'ghost', 'first-card', 'shine'] as const;
export type TipKey = (typeof TIP_KEYS)[number];

/** The tour's steps, in order. `replayTour` forgets exactly these on the account (supabase/migrations). */
export const TOUR_KEYS = ['tour-plate', 'tour-orbs', 'tour-hand'] as const satisfies readonly TipKey[];

/** The tips the engine gives an action (a button before Got it), so an instance must word its label (`instanceUiProblems`). */
export const ACTION_TIPS = ['shine'] as const satisfies readonly TipKey[];
