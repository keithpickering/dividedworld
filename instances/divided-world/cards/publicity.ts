/**
 * The numbers Publicity Tour and Hype-Up share, so "Hype-Up's numbers are Publicity Tour's" is one list (docs/plans/2026-11-11-card-notes-part-4-plan.md; no card file imports another card).
 */
import type { GimmickEffect } from '../../../engine/rules/cards.ts';
import type { Span } from '../../../engine/rules/types.ts';

/** The push Publicity Tour gives its own character and Hype-Up gives another's. One group: the two do not add, and the larger applies. */
export const PUBLICITY: GimmickEffect = { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.1, group: 'publicity' };
export const PUBLICITY_LASTS: Span = { unit: 'hour', count: 36 };
