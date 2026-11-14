import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { RandomEvent } from './RandomEvent.tsx';

/* A gear (uncommon) and a card (rare) to be found, and a line for each outcome. */
const shop: Instance = {
  ...testInstance,
  cards: [...testInstance.cards, { ...testInstance.cards[0]!, key: 'trap', name: 'Trap Card', rarity: 'rare' }],
  gear: [{ key: 'band', name: 'Headband', line: 'Holds a thought in place.', rarity: 'uncommon' }],
  events: { lines: [
    { key: 'bench', outcome: 'gear', text: 'You found {item} under a park bench.' },
    { key: 'shoe', outcome: 'card', text: 'A postcard was stuck to your shoe. It is {item}.' },
    { key: 'statue', outcome: 'line', text: 'You touched the statue.' },
  ] },
};

function world(signedIn = true): { readonly fake: Fake; readonly pipe: string } {
  const fake = buildWorld(undefined, shop);
  const account = fake.seed.account('ana');
  const pipe = fake.seed.character(account, 'Pipewrench', 'heel');
  if (signedIn) fake.signInAs(account);
  return { fake, pipe };
}

/** A page that can render again (its control counts), with the dialog's host in it. */
function Page() {
  const [n, count] = useState(0);
  return <><button type="button" onClick={() => count(n + 1)}>Page control {n}</button><RandomEvent /></>;
}

const open = (fake: Fake, state?: unknown) => renderIn(fake, <Page />, { instance: shop, path: '/b/general', ...(state === undefined ? {} : { state }) });

beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); vi.restoreAllMocks(); });

describe('the Random Event dialog', () => {
  test('a found gear names the item, its rarity in words and the mask, and says only the player sees it', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'gear', item: 'band', line: 'bench' });
    open(fake);
    const dialog = await screen.findByRole('dialog', { name: 'SOMETHING HAPPENED!' });
    expect(within(dialog).getByText('You found Headband under a park bench.')).toBeInTheDocument();
    expect(within(dialog).getByText(/uncommon gear/iu)).toBeInTheDocument();
    expect(within(dialog).getByText('It happened to Pipewrench. Only you see this.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Wear it' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  test('a found card names the card and its rarity, and offers no Wear it', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'card', item: 'trap', line: 'shoe' });
    open(fake);
    const dialog = await screen.findByRole('dialog', { name: 'SOMETHING HAPPENED!' });
    expect(within(dialog).getByText('A postcard was stuck to your shoe. It is Trap Card.')).toBeInTheDocument();
    expect(within(dialog).getByText(/rare card/iu)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Wear it' })).toBeNull();
    expect(within(dialog).getByText('It happened to Pipewrench. Only you see this.')).toBeInTheDocument();
  });

  test('a line alone shows no item and no rarity', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'line', line: 'statue' });
    open(fake);
    const dialog = await screen.findByRole('dialog', { name: 'SOMETHING HAPPENED!' });
    expect(within(dialog).getByText('You touched the statue.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/gear|card/iu)).toBeNull();
    expect(within(dialog).queryByRole('link', { name: 'Wear it' })).toBeNull();
  });

  test('an item key this instance does not know is still named, never called nothing', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'gear', item: 'mystery-hat', line: 'bench' });
    open(fake);
    const dialog = await screen.findByRole('dialog', { name: 'SOMETHING HAPPENED!' });
    expect(within(dialog).getByText('You found mystery-hat under a park bench.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Wear it' })).toBeNull();
  });

  test('Esc closes it, and focus returns to where it was', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'line', line: 'statue' });
    open(fake);
    screen.getByRole('button', { name: /^Page control/u }).focus();
    await screen.findByRole('dialog', { name: 'SOMETHING HAPPENED!' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /^Page control/u })).toHaveFocus();
  });

  test('OK closes it', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'line', line: 'statue' });
    open(fake);
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('Wear it goes to the wardrobe on that mask, carrying the gear to place', async () => {
    const { fake, pipe } = world();
    fake.seed.nextEvent({ outcome: 'gear', item: 'band', line: 'bench' });
    open(fake);
    await userEvent.click(await screen.findByRole('link', { name: 'Wear it' }));
    await waitFor(() => expect(window.location.pathname).toBe('/wardrobe'));
    expect((window.history.state as { state: unknown }).state).toEqual({ character: pipe, wear: 'band' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('it has no axe violations', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'gear', item: 'band', line: 'bench' });
    open(fake);
    const dialog = await screen.findByRole('dialog', { name: 'SOMETHING HAPPENED!' });
    const found = await axeViolations(dialog);
    expect(describeViolations(found)).toBe('');
  });
});

describe('when it rolls', () => {
  test('no answer (a roll that finds nothing) opens nothing', async () => {
    const { fake } = world();
    fake.seed.nextEvent(null);
    const rolled = vi.spyOn(fake, 'randomEvent');
    open(fake);
    await waitFor(() => expect(rolled).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a failed roll shows nothing, no alert and no dialog', async () => {
    const { fake } = world();
    const rolled = vi.spyOn(fake, 'randomEvent').mockRejectedValue(new Error('offline'));
    open(fake);
    await waitFor(() => expect(rolled).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a refused roll shows nothing', async () => {
    const { fake } = world();
    vi.spyOn(fake, 'randomEvent').mockResolvedValue({ ok: false, error: 'no' });
    open(fake);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a signed-out visitor never rolls', async () => {
    const { fake } = world(false);
    const rolled = vi.spyOn(fake, 'randomEvent');
    open(fake);
    await new Promise((r) => setTimeout(r, 60));
    expect(rolled).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a player with no character to roll for never rolls', async () => {
    const fake = buildWorld(undefined, shop);
    fake.signInAs(fake.seed.account('ana'));
    const rolled = vi.spyOn(fake, 'randomEvent');
    open(fake);
    await new Promise((r) => setTimeout(r, 60));
    expect(rolled).not.toHaveBeenCalled();
  });

  test('it rolls once per page load, not once per render', async () => {
    const { fake } = world();
    fake.seed.nextEvent({ outcome: 'line', line: 'statue' });
    const rolled = vi.spyOn(fake, 'randomEvent');
    open(fake);
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /^Page control/u }));
    await screen.findByRole('button', { name: 'Page control 1' });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rolled).toHaveBeenCalledTimes(1);
  });
});
