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

  test('a player who calls the admin api methods is refused', async () => {
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('machine-player'));
    await expect(async () => fake.adminMachine()).rejects.toThrow(/only an admin/u);
    const id = (await fake.machine())[0]!.id;
    expect(await fake.setSlot(id, 'soldOut', 100)).toMatchObject({ ok: false });
    expect(await fake.moveSlot(id, 'down')).toMatchObject({ ok: false });
    expect(await fake.saveMachine([{ slot: id, availability: 'soldOut', price: 100 }])).toMatchObject({ ok: false });
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

  test('moves a slot down and up from the keyboard on the page only, keeps focus on its button, and says where it now stands', async () => {
    const fake = open();
    await names();
    const user = userEvent.setup();
    const saved = vi.spyOn(fake, 'saveMachine');
    const moved = vi.spyOn(fake, 'moveSlot');
    screen.getByRole('button', { name: 'Booster: move down' }).focus();
    await user.keyboard('{Enter}');
    expect(await names()).toEqual(['Whoops!', 'Booster', 'Bluff', 'Trap Card', 'Main Event']);
    expect(screen.getByRole('status')).toHaveTextContent('Booster is now 2nd in the list and 2nd on the machine.');
    expect(screen.getByRole('button', { name: 'Booster: move down' })).toHaveFocus();
    /* The slot codes follow the order on the page. */
    expect((await rows()).map((x) => x.querySelector('td')!.textContent)).toEqual(['A1', 'A2', 'B1', 'B2', '–']);
    await user.click(screen.getByRole('button', { name: 'Booster: move up' }));
    expect(await names()).toEqual(['Booster', 'Whoops!', 'Bluff', 'Trap Card', 'Main Event']);
    /* The Booster reached the end of its arrow's road: its up arrow is disabled, so focus went to its other arrow and not to the page. */
    await waitFor(() => expect(screen.getByRole('button', { name: 'Booster: move down' })).toHaveFocus());
    expect(saved).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
  });

  test('moving and not saving changes nothing on the machine, and a reload drops the move', async () => {
    const fake = open();
    await names();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Booster: move down' }));
    expect(await names()).toEqual(['Whoops!', 'Booster', 'Bluff', 'Trap Card', 'Main Event']);
    expect((await fake.adminMachine()).map((x) => x.id)[0]).toBe((await fake.machine())[0]!.id);
    expect((await fake.machine()).map((x) => 'pack' in x.item ? x.item.pack : x.item.card)).toEqual(['booster', 'whoops', 'bluff', 'trap']);
    cleanup();
    renderIn(fake, <MachineScreen />, { path: '/admin/machine', instance, packs });
    expect(await names()).toEqual(['Booster', 'Whoops!', 'Bluff', 'Trap Card', 'Main Event']);
  });

  test('the status names a moved slot\'s place on the machine, and says a hidden one stands on none', async () => {
    open();
    await names();
    const user = userEvent.setup();
    /* Main Event is hidden: moving Trap Card down swaps it past the hidden row, so the list changes and the front does not. */
    await user.click(screen.getByRole('button', { name: 'Trap Card: move down' }));
    expect(await names()).toEqual(['Booster', 'Whoops!', 'Bluff', 'Main Event', 'Trap Card']);
    expect(screen.getByRole('status')).toHaveTextContent('Trap Card is now 5th in the list and 4th on the machine.');
    await user.click(screen.getByRole('button', { name: 'Main Event: move down' }));
    expect(screen.getByRole('status')).toHaveTextContent('Main Event is now 5th in the list and not on the machine, since it is hidden.');
  });

  test('Save changes saves the moved order, in one call', async () => {
    const fake = open();
    await names();
    const user = userEvent.setup();
    const saved = vi.spyOn(fake, 'saveMachine');
    await user.click(screen.getByRole('button', { name: 'Booster: move down' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/^Saved\. Players see it at once\./u)).toBeInTheDocument();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0]![0].map((c) => c.slot)).toEqual((await fake.adminMachine()).map((x) => x.id));
    expect((await fake.machine()).map((x) => 'pack' in x.item ? x.item.pack : x.item.card)).toEqual(['whoops', 'booster', 'bluff', 'trap']);
    expect(await names()).toEqual(['Whoops!', 'Booster', 'Bluff', 'Trap Card', 'Main Event']);
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
    const set = vi.spyOn(fake, 'saveMachine');
    const price = screen.getByRole('textbox', { name: 'Bluff: price' });
    await user.clear(price);
    await user.type(price, 'cheap');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Whoops!: availability' }), 'soldOut');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bluff: a price is an amount in orbs between 0.01 and 1,000,000.00, like 1.50.');
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(price.getAttribute('aria-describedby')).toContain((await screen.findByRole('alert')).id);
    expect(screen.getByText(/^A price is between 0\.01 and 1,000,000\.00\./u)).toBeInTheDocument();
    expect(set).not.toHaveBeenCalled();
  });

  test('a refusal mid-list saves nothing, names the slot, and marks the field it is about', async () => {
    const fake = open();
    await names();
    const user = userEvent.setup();
    /* The server refuses the second slot's availability (as a stale page might), after the first was changed and the order moved. */
    vi.spyOn(fake, 'saveMachine').mockImplementation(async (changes) => ({ ok: false, error: 'a slot is on sale, sold out or hidden', field: `${changes[2]!.slot}/availability` }));
    const price = screen.getByRole('textbox', { name: 'Whoops!: price' });
    await user.clear(price);
    await user.type(price, '9');
    await user.click(screen.getByRole('button', { name: 'Booster: move down' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bluff: a slot is on sale, sold out or hidden Nothing was saved.');
    const select = screen.getByRole('combobox', { name: 'Bluff: availability' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')).toBe(alert.id);
    expect(screen.getByRole('textbox', { name: 'Bluff: price' })).not.toHaveAttribute('aria-invalid');
    /* The page keeps what the admin did, so they can fix it and save again; the machine has none of it. */
    expect(screen.getByRole('textbox', { name: 'Whoops!: price' })).toHaveValue('9');
    expect((await fake.adminMachine()).find((x) => 'card' in x.item && x.item.card === 'whoops')!.price).toBe(100);
    expect((await fake.machine())[0]!.id).toBe((await fake.adminMachine())[0]!.id);
  });

  test('a real refusal of the whole list saves nothing: the fake refuses a price of nothing and leaves the order and the other slots alone', async () => {
    const fake = open();
    const before = await fake.adminMachine();
    const changes = before.map((x) => ({ slot: x.id, availability: x.availability, price: x.price }));
    const flipped = [changes[1]!, changes[0]!, ...changes.slice(2, 4), { ...changes[4]!, price: 0 }];
    flipped[0] = { ...flipped[0]!, price: 999 };
    expect(await fake.saveMachine(flipped)).toEqual({ ok: false, error: 'a price is at least 0.01', field: `${changes[4]!.slot}/price` });
    expect(await fake.adminMachine()).toEqual(before);
  });

  test('a Boss move in force shows on its slot in plain words, with a link to reverse it in the queue', async () => {
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
    expect(within(r[1]!).getByRole('link', { name: /^Reverse in the queue/u })).toHaveAttribute('href', '/admin/queue');
    expect(within(r[0]!).queryByRole('link')).toBeNull();
    expect(within(r[4]!).getByText('Only in packs. The Boss may flash-sale it.')).toBeInTheDocument();
  });
});

describe('taking a pack off sale', () => {
  test('ends the Boss\'s Pull of a card no pack on sale can still give, and the status says so', async () => {
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('machine-admin', { admin: true }));
    fake.seed.slot({ card: 'whoops' }, { availability: 'soldOut', move: { kind: 'pullSlot', act: 'no-such-act', ends: '2026-11-09T12:00:00.000Z', demand: null, progress: null, was: 100, percent: null, hours: null } });
    cleanup();
    renderIn(fake, <MachineScreen />, { path: '/admin/machine', instance, packs });
    await names();
    expect(within((await rows())[1]!).getByText(/^Pulled by the Boss/u)).toBeInTheDocument();
    const user = userEvent.setup();
    /* The Booster is the only pack and it gives common cards: off sale, Whoops! is in no pack on sale. */
    await user.selectOptions(screen.getByRole('combobox', { name: 'Booster: availability' }), 'soldOut');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/A Boss pull ended, since no pack on sale can still give its card\./u)).toBeInTheDocument();
    expect(within((await rows())[1]!).queryByText(/^Pulled by the Boss/u)).toBeNull();
    expect((await fake.machine()).find((x) => 'card' in x.item && x.item.card === 'whoops')).toMatchObject({ availability: 'onSale', move: null });
  });

  test('a card slot going off sale ends nothing', async () => {
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('machine-admin', { admin: true }));
    fake.seed.slot({ card: 'whoops' }, { availability: 'soldOut', move: { kind: 'pullSlot', act: 'no-such-act', ends: '2026-11-09T12:00:00.000Z', demand: null, progress: null, was: 100, percent: null, hours: null } });
    const slot = (await fake.adminMachine()).find((x) => 'card' in x.item && x.item.card === 'bluff')!;
    expect(await fake.setSlot(slot.id, 'soldOut', slot.price)).toMatchObject({ ok: true, value: { ended: 0 } });
    expect((await fake.adminMachine()).find((x) => 'card' in x.item && x.item.card === 'whoops')!.move).not.toBeNull();
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
    expect(hundredths('abc')).toBeNull();
    expect(hundredths('2.505')).toBeNull();
    expect(hundredths('1000000')).toBe(100000000);
    expect(hundredths('1000000.00')).toBe(100000000);
    expect(hundredths('1000000.01')).toBeNull();
    expect(hundredths('9999999')).toBeNull();
  });
});
