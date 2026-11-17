/**
 * The numbers Publicity Tour and Hype-Up share, so "Hype-Up's numbers are Publicity Tour's" is one list (docs/plans/2026-11-11-card-notes-part-4-plan.md; no card file imports another card).
 */
import type { GimmickEffect } from '../../../engine/rules/cards.ts';
import type { Span } from '../../../engine/rules/types.ts';

/** The push Publicity Tour gives its own character: half a vote more on each positive vote, whatever class it holds. Hype-Up gives one post a whole vote on the same quadrants; where the two are up on one vote, only the larger pays. */
export const PUBLICITY: GimmickEffect = { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], flat: 0.5 };
/** Hype-Up's push on one post: Publicity Tour's quadrants, at a whole vote. */
export const HYPE: GimmickEffect = { ...PUBLICITY, flat: 1 };
export const PUBLICITY_LASTS: Span = { unit: 'day', count: 3 };
