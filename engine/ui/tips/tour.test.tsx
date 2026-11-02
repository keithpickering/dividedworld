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

async function world(options: { welcomed?: boolean; character?: boolean } = {}): Promise<Fake> {
  const { welcomed = true, character = true } = options;
  const fake = buildWorld();
  const me = fake.seed.account('me');
  if (character) fake.seed.character(me, 'Pipewrench', 'face');
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

  test('nothing shows before the welcome is seen, or for an account with no character, or for a visitor', async () => {
    for (const fake of [await world({ welcomed: false }), await world({ character: false }), buildWorld()]) {
      const view = board(fake);
      await settle();
      expect(screen.queryByRole('dialog')).toBeNull();
      view.unmount();
    }
  });

  test('under reduced motion the dialog appears at once, without a fade', async () => {
    const fake = await world();
    await fake.setPreferences({ motion: 'reduce' });
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    board(fake);
    const one = await screen.findByRole('dialog', { name: 'Title of tour-plate' });
    expect(one.closest('[style*="opacity"]')?.getAttribute('style') ?? '').not.toMatch(/opacity:\s*0(?![.\d])/u);
  });
});
