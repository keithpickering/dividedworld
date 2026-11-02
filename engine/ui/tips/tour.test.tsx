/**
 * The HUD tour (docs/plans/2026-11-02-onboarding-plan.md, Task 5): on a board page, once the account has a character and has seen the
 * welcome, the HUD's plate, orbs and Hand button are shown in turn, "N of 3"; a reload resumes at the step not yet seen; Skip ends the
 * tour and every later tip; reduced motion jumps.
 */
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Frame } from '../frame/Frame.tsx';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });

async function world(options: { welcomed?: boolean; character?: boolean; debuted?: boolean; retired?: boolean } = {}): Promise<Fake> {
  const { welcomed = true, character = true, debuted = true, retired = false } = options;
  const fake = buildWorld();
  const me = fake.seed.account('me');
  if (character) fake.seed.character(me, 'Pipewrench', 'face', { debuted, retired });
  fake.signInAs(me);
  if (welcomed) await fake.seeWelcome();
  return fake;
}
const board = (fake: Fake) => renderIn(fake, <Frame><p>A board page.</p></Frame>);
const gotIt = (d: HTMLElement) => userEvent.click(within(d).getByRole('button', { name: 'Got it' }));

describe('the HUD tour', () => {
  test('a new account with one character sees step 1 on its first board page, and Got it moves to 2 then 3', async () => {
    const fake = await world();
    board(fake);
    const one = await screen.findByRole('dialog', { name: 'Title of tour-plate' });
    expect(within(one).getByText(/1 of 3/u)).toBeInTheDocument();
    await gotIt(one);
    const two = await screen.findByRole('dialog', { name: 'Title of tour-orbs' });
    expect(within(two).getByText(/2 of 3/u)).toBeInTheDocument();
    await gotIt(two);
    const three = await screen.findByRole('dialog', { name: 'Title of tour-hand' });
    expect(within(three).getByText(/3 of 3/u)).toBeInTheDocument();
    await gotIt(three);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await fake.preferences()).tipsSeen).toEqual(['tour-plate', 'tour-orbs', 'tour-hand']);
  });

  test('a reload after step 2 resumes at step 3, still "3 of 3"', async () => {
    const fake = await world();
    const first = board(fake);
    await gotIt(await screen.findByRole('dialog', { name: 'Title of tour-plate' }));
    await gotIt(await screen.findByRole('dialog', { name: 'Title of tour-orbs' }));
    first.unmount();
    board(fake);
    const three = await screen.findByRole('dialog', { name: 'Title of tour-hand' });
    expect(within(three).getByText(/3 of 3/u)).toBeInTheDocument();
  });

  test('Skip at step 1 ends the tour and every later tip', async () => {
    const fake = await world();
    const first = board(fake);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip all tips' }));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await fake.preferences()).tips).toBe('off');
    first.unmount();
    board(fake);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Skip at step 2 stops step 3, and nothing shows on a reload', async () => {
    const fake = await world();
    const first = board(fake);
    await gotIt(await screen.findByRole('dialog', { name: 'Title of tour-plate' }));
    await screen.findByRole('dialog', { name: 'Title of tour-orbs' });
    await userEvent.click(screen.getByRole('button', { name: 'Skip all tips' }));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    board(fake);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('an account that had a character before the welcome shipped (no welcomedAt) sees no tour', async () => {
    const fake = await world({ welcomed: false });
    expect((await fake.preferences()).welcomedAt).toBeFalsy();
    board(fake);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /* The tour's gate is the HUD's acting character (debuted, not retired): the plate and the hand need one. */
  test('an account whose only character has not debuted sees no tour yet', async () => {
    const fake = await world({ debuted: false });
    board(fake);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('an account whose only character is retired sees no tour', async () => {
    const fake = await world({ retired: true });
    board(fake);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /* Two readers make a read on a board page: the tips provider's (the tips and the tour share it) and the alerts feed's
     (engine/ui/alerts/useAlerts.ts). The baseline is the same page for an account the tour does not apply to, so a new reader elsewhere
     moves both counts alike, and only a read the tour itself adds (as the HUD did before, a third) breaks the equality. */
  /* A baseline page would hide the defect this guards: the HUD's old read of its own ran for every signed-in account, tour or not. So
   * the count is absolute: the page's readers of the preferences are the tips provider (which carries the welcome to the tour) and the
   * alerts feed (engine/ui/alerts/useAlerts.ts). A third reader added anywhere on the board page fails here and should be counted here. */
  test('the tour adds no preferences read of its own to the page load', async () => {
    const fake = await world();
    const read = vi.spyOn(fake, 'preferences');
    board(fake);
    await screen.findByRole('dialog', { name: 'Title of tour-plate' });
    await settle();
    expect(read, 'the tips provider\'s read and the alerts feed\'s, and no third').toHaveBeenCalledTimes(2);
  });

  /* Each step cuts out its own element: the rects below differ, and the ring takes the one of the element the step points at. */
  describe('each step points at its own element', () => {
    const rects: Record<string, { left: number; top: number; width: number; height: number }> = {
      'kb-hud-plate': { left: 100, top: 100, width: 200, height: 60 },
      'kb-hud-aura': { left: 400, top: 300, width: 120, height: 40 },
      'kb-hud-hand': { left: 600, top: 500, width: 80, height: 30 },
    };
    const ringOf = (name: string) => {
      const r = rects[name]!;
      return [`${r.left - 6}px`, `${r.top - 6}px`, `${r.width + 12}px`, `${r.height + 12}px`];
    };
    const ring = () => {
      const el = document.querySelector<HTMLElement>('.kb-tips-ring')!;
      return [el.style.left, el.style.top, el.style.width, el.style.height];
    };
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const key = Object.keys(rects).find((k) => this.classList.contains(k));
        const r = key ? rects[key]! : { left: 0, top: 0, width: 0, height: 0 };
        return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
      });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    test('step 1 the plate, step 2 the orbs, step 3 the Hand button', async () => {
      const fake = await world();
      board(fake);
      const one = await screen.findByRole('dialog', { name: 'Title of tour-plate' });
      expect(ring(), 'the rects distinguish the elements: the plate is not the orbs').not.toEqual(ringOf('kb-hud-aura'));
      expect(ring()).toEqual(ringOf('kb-hud-plate'));
      await gotIt(one);
      await screen.findByRole('dialog', { name: 'Title of tour-orbs' });
      expect(ring()).not.toEqual(ringOf('kb-hud-hand'));
      expect(ring()).toEqual(ringOf('kb-hud-aura'));
      await gotIt(screen.getByRole('dialog'));
      await screen.findByRole('dialog', { name: 'Title of tour-hand' });
      expect(ring()).not.toEqual(ringOf('kb-hud-plate'));
      expect(ring()).toEqual(ringOf('kb-hud-hand'));
      expect(document.querySelector('.kb-hud-hand')).toBe(screen.getByRole('button', { name: /^Hand,/u }));
    });
  });

  test('nothing shows before the welcome is seen, or for an account with no character, or for a visitor', async () => {
    for (const fake of [await world({ welcomed: false }), await world({ character: false }), buildWorld()]) {
      const view = board(fake);
      await settle();
      expect(screen.queryByRole('dialog')).toBeNull();
      view.unmount();
    }
  });

  /* The overlay fades in from opacity 0 unless motion is reduced. The pair shows the check can see a fade: the same page, not reduced, has it. */
  const startsHidden = (dialog: HTMLElement) => /opacity:\s*0(?![.\d])/u.test(dialog.closest<HTMLElement>('.kb-tips')?.getAttribute('style') ?? '');

  test('without reduced motion the dialog fades in from opacity 0', async () => {
    const fake = await world();
    board(fake);
    const one = await screen.findByRole('dialog', { name: 'Title of tour-plate' });
    expect(one.closest('.kb-tips'), 'the overlay wrapper is found').not.toBeNull();
    expect(startsHidden(one)).toBe(true);
  });

  test('under reduced motion the dialog appears at once, without a fade', async () => {
    const fake = await world();
    await fake.setPreferences({ motion: 'reduce' });
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    board(fake);
    const one = await screen.findByRole('dialog', { name: 'Title of tour-plate' });
    const wrapper = one.closest<HTMLElement>('.kb-tips');
    expect(wrapper, 'the overlay wrapper is found, so the check below is not vacuous').not.toBeNull();
    expect(startsHidden(one)).toBe(false);
  });
});
