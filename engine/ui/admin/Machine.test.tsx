import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { hundredths, MachineScreen } from './Machine.tsx';

beforeEach(() => localStorage.clear());

const card = (key: string, name: string, rarity: 'common' | 'uncommon' | 'rare') => ({ ...testInstance.cards[0]!, key, name, rarity });
/* Five slots: a Booster, two cards on sale, one sold out and one hidden. */
const instance: Instance = {
  ...testInstance,
  cards: [card('whoops', 'Whoops!', 'common'), card('bluff', 'Bluff', 'common'), card('trap', 'Trap Card', 'uncommon'), card('main', 'Main Event', 'rare')],
  packs: [{ key: 'booster', pulls: [{ weights: { common: 1 } }, { weights: { common: 1 } }, { weights: { common: 1 } }, { weights: { common: 1 } }, { weights: { uncommon: 1 } }] }],
  machine: [
    { item: { pack: 'booster' }, availability: 'onSale', price: 300 }, { item: { card: 'whoops' }, availability: 'onSale', price: 100 },
    { item: { card: 'bluff' }, availability: 'onSale', price: 25 }, { item: { card: 'trap' }, availability: 'soldOut', price: 150 },
    { item: { card: 'main' }, availability: 'hidden', price: 300 },
  ],
};
const packs = { booster: { name: 'Booster', art: {} } } as never;

function open(as: 'admin' | 'player' = 'admin') {
  const fake = buildWorld(undefined, instance);
  const admin = fake.seed.account('machine-admin', { admin: true });
  const player = fake.seed.account('machine-player');
  fake.signInAs(as === 'admin' ? admin : player);
  renderIn(fake, <MachineScreen />, { path: '/admin/machine', instance, packs });
  return fake;
}

const rows = async () => (await screen.findAllByRole('row')).slice(1);
const names = async () => (await rows()).map((r) => within(r).getByRole('rowheader').firstChild!.textContent);

describe('the machine\'s admin page', () => {
  test('lists every slot in grid order, the hidden one too, with its code, item, availability and price', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'The machine' })).toBeInTheDocument();
    expect(await names()).toEqual(['Booster', 'Whoops!', 'Bluff', 'Trap Card', 'Main Event']);
    const r = await rows();
    expect(within(r[0]!).getByRole('rowheader')).toHaveTextContent('pack · 5 cards');
    expect(within(r[2]!).getByRole('rowheader')).toHaveTextContent('common');
    expect(r.map((x) => x.querySelector('td')!.textContent)).toEqual(['A1', 'A2', 'B1', 'B2', '–']);
    expect(screen.getByRole('combobox', { name: 'Trap Card: availability' })).toHaveValue('soldOut');
    expect(screen.getByRole('combobox', { name: 'Main Event: availability' })).toHaveValue('hidden');
    expect(screen.getByRole('textbox', { name: 'Bluff: price' })).toHaveValue('0.25');
    expect(screen.getByRole('textbox', { name: 'Booster: price' })).toHaveValue('3.00');
  });

  test('shares the admin pages\' strip with the queue: Moves, and The machine as the current page', async () => {
    open();
    const strip = await screen.findByRole('navigation', { name: 'Admin pages' });
    const moves = within(strip).getByRole('link', { name: 'Moves' });
    const here = within(strip).getByRole('link', { name: 'The machine' });
    expect(moves).toHaveAttribute('href', '/admin/queue');
    expect(moves).not.toHaveAttribute('aria-current');
    expect(here).toHaveAttribute('aria-current', 'page');
    expect(here).toHaveAttribute('data-kb-kind', 'primary');
  });

  test('a player is told plainly that it is for admins, and the machine is not asked for', async () => {
    const fake = buildWorld(undefined, instance);
    const player = fake.seed.account('machine-player');
    fake.signInAs(player);
    const asked = vi.spyOn(fake, 'adminMachine');
    renderIn(fake, <MachineScreen />, { path: '/admin/machine', instance, packs });
    expect(await screen.findByText('The machine\'s page is for admins.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    cleanup();
  });

  test('a player who calls the three api methods is refused', async () => {
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('machine-player'));
    await expect(async () => fake.adminMachine()).rejects.toThrow(/only an admin/u);
    const id = (await fake.machine())[0]!.id;
    expect(await fake.setSlot(id, 'soldOut', 100)).toMatchObject({ ok: false });
    expect(await fake.moveSlot(id, 'down')).toMatchObject({ ok: false });
    expect((await fake.machine())[0]).toMatchObject({ availability: 'onSale', price: 300 });
  });

  test('moving the first slot up does nothing: its button is disabled, and the call changes no order', async () => {
    const fake = open();
    await names();
    expect(screen.getByRole('button', { name: 'Booster: move up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Main Event: move down' })).toBeDisabled();
    const first = (await fake.adminMachine())[0]!;
    expect(await fake.moveSlot(first.id, 'up')).toEqual({ ok: true, value: { slot: first.id, moved: false } });
    expect((await fake.adminMachine()).map((s) => s.id)[0]).toBe(first.id);
    expect(await names()).toEqual(['Booster', 'Whoops!', 'Bluff', 'Trap Card', 'Main Event']);
  });

  test('moves a slot down and up from the keyboard, swapping with its neighbor, and keeps focus on the slot that moved', async () => {
    open();
    await names();
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Booster: move down' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(async () => expect(await names()).toEqual(['Whoops!', 'Booster', 'Bluff', 'Trap Card', 'Main Event']));
    expect(screen.getByRole('status')).toHaveTextContent('Moved Booster down.');
    expect(screen.getByRole('button', { name: 'Booster: move down' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Booster: move up' }));
    await waitFor(async () => expect(await names()).toEqual(['Booster', 'Whoops!', 'Bluff', 'Trap Card', 'Main Event']));
    /* The Booster reached the end of its arrow's road: its up arrow is disabled, so focus went to its other arrow and not to the page. */
    await waitFor(() => expect(screen.getByRole('button', { name: 'Booster: move down' })).toHaveFocus());
  });

  test('one Save changes saves every changed availability and price, and a saved price shows on the machine', async () => {
    const fake = open();
    await names();
    const user = userEvent.setup();
    const price = screen.getByRole('textbox', { name: 'Whoops!: price' });
    await user.clear(price);
    await user.type(price, '1.75');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bluff: availability' }), 'soldOut');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Main Event: availability' }), 'onSale');
    /* Nothing is sent until Save changes. */
    expect((await fake.machine()).find((s) => 'card' in s.item && s.item.card === 'whoops')!.price).toBe(100);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/^Saved\. Players see it at once\./u)).toBeInTheDocument();
    const slots = await fake.machine();
    expect(slots.find((s) => 'card' in s.item && s.item.card === 'whoops')!.price).toBe(175);
    expect(slots.find((s) => 'card' in s.item && s.item.card === 'bluff')!.availability).toBe('soldOut');
    expect(slots.some((s) => 'card' in s.item && s.item.card === 'main')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Whoops!: price' })).toHaveValue('1.75');
  });

  test('a price that is no amount refuses the save in words beside it and sends nothing', async () => {
    const fake = open();
    await names();
    const user = userEvent.setup();
    const set = vi.spyOn(fake, 'setSlot');
    const price = screen.getByRole('textbox', { name: 'Bluff: price' });
    await user.clear(price);
    await user.type(price, 'cheap');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Whoops!: availability' }), 'soldOut');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bluff: a price is an amount in orbs, like 1.50, of at least 0.01.');
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(set).not.toHaveBeenCalled();
  });

  test('a Boss move in force shows on its slot in plain words, with a link to the queue', async () => {
    const fake = open();
    await names();
    const real = fake.adminMachine.bind(fake);
    const slots = await real();
    const until = '2026-11-09T12:00:00.000Z';
    vi.spyOn(fake, 'adminMachine').mockImplementation(async () => slots.map((s, i) => (i === 1
      ? { ...s, move: { kind: 'pullSlot' as const, act: 'act-1', ends: until, percent: null, hours: null } }
      : i === 2 ? { ...s, move: { kind: 'repriceSlot' as const, act: 'act-2', ends: until, percent: 150, hours: null } } : s)));
    cleanup();
    renderIn(fake, <MachineScreen />, { path: '/admin/machine', instance, packs });
    const r = await rows();
    expect(within(r[1]!).getByText(/^Pulled by the Boss/u)).toBeInTheDocument();
    expect(within(r[2]!).getByText(/^Marked up ×1\.5 · 0\.38/u)).toBeInTheDocument();
    expect(within(r[1]!).getByRole('link', { name: /^In the queue/u })).toHaveAttribute('href', '/admin/queue');
    expect(within(r[0]!).queryByRole('link')).toBeNull();
    expect(within(r[4]!).getByText('Only in packs. The Boss may flash-sale it.')).toBeInTheDocument();
  });
});

describe('a price as typed', () => {
  test('is whole orbs or up to two decimals, at least 0.01, as hundredths', () => {
    expect(hundredths('3')).toBe(300);
    expect(hundredths('1.5')).toBe(150);
    expect(hundredths(' 0.25 ')).toBe(25);
    expect(hundredths('0.01')).toBe(1);
    expect(hundredths('0')).toBeNull();
    expect(hundredths('0.00')).toBeNull();
    expect(hundredths('1.234')).toBeNull();
    expect(hundredths('-1')).toBeNull();
    expect(hundredths('1e3')).toBeNull();
    expect(hundredths('')).toBeNull();
  });
});
