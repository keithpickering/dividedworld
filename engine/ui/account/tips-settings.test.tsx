/**
 * Settings' Tips row and the next board page (docs/plans/2026-11-02-onboarding-plan.md, Task 9): each control calls its RPC, and the board the
 * player opens next behaves as it says. The tour is the tip these use, as tour.test.tsx does.
 */
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Frame } from '../frame/Frame.tsx';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { SettingsScreen } from './Settings.tsx';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { cleanup(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });

async function world(welcomed = true): Promise<Fake> {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  fake.seed.character(me, 'Pipewrench', 'face', { debuted: true });
  fake.signInAs(me);
  if (welcomed) await fake.seeWelcome();
  return fake;
}
const board = (fake: Fake) => renderIn(fake, <Frame><p>A board page.</p></Frame>);
/** Open Settings, do `act`, wait for the save, and leave. */
async function inSettings(fake: Fake, act_: () => Promise<void>) {
  const view = renderIn(fake, <SettingsScreen />, { path: '/settings' });
  await screen.findByRole('switch', { name: 'Tips' });
  await act_();
  await settle();
  view.unmount();
}
const nothing = async (fake: Fake) => { board(fake); await settle(); expect(screen.queryByRole('dialog')).toBeNull(); };

describe('Settings › Tips, and the next board page', () => {
  test('the switch off: no tip shows on the next board page; on again: the tour shows', async () => {
    const fake = await world();
    await inSettings(fake, () => userEvent.click(screen.getByRole('switch', { name: 'Tips' })));
    expect((await fake.preferences()).tips).toBe('off');
    await nothing(fake);
    cleanup();
    await inSettings(fake, () => userEvent.click(screen.getByRole('switch', { name: 'Tips' })));
    board(fake);
    expect(await screen.findByRole('dialog', { name: 'Title of tour-plate' })).toBeInTheDocument();
  });

  test('the switch on forgets nothing: a tip already seen stays seen', async () => {
    const fake = await world();
    await fake.seeTip('tour-plate');
    await fake.skipTips();
    await inSettings(fake, () => userEvent.click(screen.getByRole('switch', { name: 'Tips' })));
    board(fake);
    expect(await screen.findByRole('dialog', { name: 'Title of tour-orbs' })).toBeInTheDocument();
  });

  test('Show tips again: a tip already seen shows again, from the first', async () => {
    const fake = await world();
    for (const k of ['tour-plate', 'tour-orbs', 'tour-hand']) await fake.seeTip(k);
    const first = board(fake);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    await inSettings(fake, () => userEvent.click(screen.getByRole('button', { name: 'Show tips again' })));
    board(fake);
    expect(await screen.findByRole('dialog', { name: 'Title of tour-plate' })).toBeInTheDocument();
  });

  test('Replay the HUD tour: the tour shows again after it was skipped', async () => {
    const fake = await world();
    await fake.skipTips();
    await inSettings(fake, () => userEvent.click(screen.getByRole('button', { name: 'Replay the HUD tour' })));
    board(fake);
    expect(await screen.findByRole('dialog', { name: 'Title of tour-plate' })).toBeInTheDocument();
  });

  test('Replay the HUD tour works for an account that never saw the welcome', async () => {
    const fake = await world(false);
    await nothing(fake);
    cleanup();
    await inSettings(fake, () => userEvent.click(screen.getByRole('button', { name: 'Replay the HUD tour' })));
    board(fake);
    expect(await screen.findByRole('dialog', { name: 'Title of tour-plate' })).toBeInTheDocument();
  });
});
