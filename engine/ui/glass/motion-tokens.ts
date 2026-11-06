/**
 * The feels' tokens, apart from the hook and the presets (motion.ts) so the applier (apply.ts) can
 * write them to the root without a cycle through the appearance. The engine's defaults live here;
 * an instance's `GlassTheme.motion` is merged over them, token by token.
 */
import type { Feel, FeelTokens, GlassMotion } from '../types.ts';

export const FEELS: readonly Feel[] = ['smooth', 'snappy'];

export const DEFAULT_FEELS: Readonly<Record<Feel, FeelTokens>> = {
  smooth: { enter: 380, exit: 300, screen: 420, stagger: 30, ease: 'cubic-bezier(0.22, 1, 0.36, 1)', distance: 16, blur: 6, scale: 0.98, mask: 'fade' },
  snappy: { enter: 180, exit: 140, screen: 220, stagger: 24, ease: 'cubic-bezier(0.22, 1, 0.36, 1)', spring: { stiffness: 520, damping: 32 }, distance: 24, blur: 0, scale: 1, mask: 'skew' },
};

/** A feel's tokens: the engine's defaults, with the instance's overrides for that feel over them. */
export function feelTokens(feel: Feel, overrides?: GlassMotion): FeelTokens {
  return { ...DEFAULT_FEELS[feel], ...overrides?.[feel] };
}
