/**
 * The tips' spotlight, drawn as stories against the boards `docs/research/2026-11-02-onboarding/03-spotlight.html` (step 2 of the HUD tour at
 * 1440 by 1120) and `04-phone.html` (step 3 docked as a sheet above the HUD at 390 by 844), and the backfill's `docs/research/2026-11-05-backfill/21-spotlight.html`
 * (step 2 at 1440 by 1000) and `22-onboarding-phone.html` (step 2 on the phone). One story per tour step, each asking for its tip
 * the way the tour will (Task 5 sequences it: the same `useTip`, a `tour` group and a step "N of 3"), pointed at the HUD's real plate, orbs
 * and hand, in a signed-in world where nothing has been seen. The words are the instance's own (`InstanceUi.onboarding`).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, type RefObject } from 'react';
import { Frame } from '../frame/Frame.tsx';
import { playerWorld } from '../story.tsx';
import type { TipKey } from './keys.ts';
import { useTip } from './Tips.tsx';

/** A ref to the HUD's part that matches `selector`, found when the tip is decided (the HUD is drawn beside the page this is in). */
function Step({ tip, n, selector }: { readonly tip: TipKey; readonly n: number; readonly selector: string }) {
  const target = useMemo<RefObject<HTMLElement | null>>(() => ({ get current() { return document.querySelector<HTMLElement>(selector); } }) as RefObject<HTMLElement | null>, [selector]);
  useTip(tip, target, { group: 'tour', step: { n, of: 3 } });
  return <p>A page.</p>;
}

const meta: Meta<typeof Step> = {
  title: 'Boards/14 Tips',
  component: Step,
  decorators: [(Story) => <Frame><Story /></Frame>],
  parameters: { world: playerWorld, layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Step>;

/** Step 1 of 3: the character plate. */
export const TourPlate: Story = { args: { tip: 'tour-plate', n: 1, selector: '.kb-hud-plate' } };
/** Step 2 of 3: the orbs, the board's own (03-spotlight.html). */
export const TourOrbs: Story = { args: { tip: 'tour-orbs', n: 2, selector: '.kb-hud-aura' } };
/** Step 3 of 3: the hand. */
export const TourHand: Story = { args: { tip: 'tour-hand', n: 3, selector: '.kb-hud-hand' } };
/** Step 2 of 3 on the Phone board's layout, the panel docked as a sheet above the HUD (the backfill's 22-onboarding-phone.html). */
export const TourOrbsPhone: Story = {
  name: 'Tour orbs, phone 390 × 844',
  args: { tip: 'tour-orbs', n: 2, selector: '.kb-hud-aura' },
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** Step 3 of 3 on the Phone board's layout, the panel docked as a sheet above the HUD (04-phone.html). */
export const TourHandPhone: Story = {
  name: 'Tour hand, phone 390 × 844',
  args: { tip: 'tour-hand', n: 3, selector: '.kb-hud-hand' },
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
