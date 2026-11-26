/**
 * Sealed packs in the hand (docs/plans/2026-11-18-starter-pack-design.md, sections 6 and 7; plan Task 6): a pack the account holds and has not opened
 * stands first in the hand, before every card, as a button; pressing it opens the reveal; the arc counts it as a place; the sheet's count leaves it out.
 * The world is a fake with one fixed pack, named by `startingPack`, so a made character is granted one sealed.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { usePlayer } from '../player.tsx';
import { Hand } from './Hand.tsx';
import { arcSlots, placesOf } from './arc.ts';
import type { CardFace } from './faces.ts';

const KEYS = ['a', 'b', 'c', 'd', 'e', 'f'];
const rules = KEYS.map((key) => ({ key, name: `Card ${key}`, alignment: 'sweet' as const, rarity: 'common' as const, stack: 9, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }) }));
const instance: Instance = { ...testInstance, cards: rules as never, settings: { ...testInstance.settings, startingPack: 'starter' }, packs: [{ key: 'starter', contents: KEYS }] as never };
const faces: CardFace[] = KEYS.map((key) => ({
  key, name: `Card ${key}`, alignment: 'sweet', tag: 'Sweet', extra: 0, stack: 1, art: { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)' },
  tagline: '', summary: `Card ${key} in a sentence.`, describe: `Card ${key}, in plain words.`, rarity: 'common', play: 'cast', kind: 'Cast',
}));
const packs = { starter: { name: 'Starter Pack', tagline: 'Six cards.', art: { color: '#ffd93d', ink: '#1a1403', canvas: '', mark: '', credit: 'Test' } } };

/** The hand as the HUD draws it: the player's cards from the player context, which the hand refreshes after an opening. */
function Live() {
  const { cards, refresh } = usePlayer();
  return <div role="region" aria-label="Your hand"><Hand held={cards} faces={faces} vendingHref="/vending" onClose={() => {}} onOpened={refresh} /></div>;
}

async function world(grant = true) {
  const fake = buildWorld(undefined, instance);
  fake.signInAs(fake.seed.account('ana'));
  if (grant) expect((await fake.createCharacter('Ana Face', 'face')).ok).toBe(true);
  /* Two cards already in hand, so there is a card group after the pack. */
  return fake;
}
const draw = (fake: Awaited<ReturnType<typeof world>>) => renderIn(fake, <Live />, { instance, packs: packs as never });
const items = () => [...document.querySelectorAll('li.kb-hand-card')];
const packButton = () => screen.findByRole('button', { name: 'Starter Pack, sealed: open it' });
const phone = () => document.documentElement.setAttribute('data-kb-text-size', '150');

beforeEach(() => document.documentElement.setAttribute('data-kb-motion', 'reduce'));
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); document.documentElement.removeAttribute('data-kb-text-size'); });

describe('the arc counts a sealed pack as a place', () => {
  test('one more slot, standing first', () => {
    expect(arcSlots(placesOf(1, [0, 0, 1, 2])).length).toBe(arcSlots([0, 0, 1, 2]).length + 1);
    expect(placesOf(2, [0, 1])).toEqual([-1, -1, 0, 1]);
    expect(placesOf(0, [0, 1])).toEqual([0, 1]);
  });
});

/** The cards held, as the player's rows would say, for a hand that is given them. */
const holding = [{ card: 'a', held: 1 }, { card: 'b', held: 2 }, { card: 'c', held: 1 }];
function Given({ held = holding, onPick }: { readonly held?: typeof holding; readonly onPick?: (f: CardFace) => void }) {
  return <div role="region" aria-label="Your hand"><Hand held={held} faces={faces} vendingHref="/vending" onClose={() => {}} {...(onPick ? { onPick } : {})} /></div>;
}
const focused = () => document.activeElement?.closest('li')?.getAttribute('data-kb-card');

describe('a sealed pack in the hand', () => {
  test('its button is the hand\'s first item, before every card, named for the pack, and it cannot be armed', async () => {
    const fake = await world();
    renderIn(fake, <Given onPick={() => {}} />, { instance, packs: packs as never });
    const pack = await packButton();
    expect(items()).toHaveLength(4);
    expect(items()[0]).toContainElement(pack);
    expect(items()[0]).toHaveAttribute('data-kb-pack');
    expect(items()[1]).toHaveAttribute('data-kb-card', 'a');
    expect(pack).not.toHaveAttribute('aria-pressed');
    expect(items()[0]).not.toHaveAttribute('data-armed');
  });

  test('the sheet\'s count leaves it out', async () => {
    const fake = await world();
    renderIn(fake, <Given />, { instance, packs: packs as never });
    await packButton();
    expect(screen.getByRole('heading', { name: /^Hand/u })).toHaveTextContent('· 4');
  });

  test('a hand with no card still shows the pack, not the empty line', async () => {
    const fake = await world();
    renderIn(fake, <Given held={[]} />, { instance, packs: packs as never });
    await packButton();
    expect(screen.queryByText(/No postcards in your hand/u)).toBeNull();
  });

  test('Left from the first card reaches the pack, Home goes to it, and Right from it reaches the first card', async () => {
    const fake = await world();
    renderIn(fake, <Given />, { instance, packs: packs as never });
    const pack = await packButton();
    const first = document.querySelector<HTMLElement>('li[data-kb-card="a"] > button')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(pack);
    fireEvent.keyDown(pack, { key: 'ArrowRight' });
    expect(focused()).toBe('a');
    fireEvent.keyDown(first, { key: 'End' });
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(pack);
  });

  test('on the Phone board the row starts with it, and it can reach the middle', async () => {
    phone();
    const fake = await world();
    renderIn(fake, <Given />, { instance, packs: packs as never });
    const pack = await packButton();
    expect(items()[0]).toContainElement(pack);
    expect(items()[0]).toHaveAttribute('data-kb-pack');
    expect(items()).toHaveLength(4);
    pack.focus();
    await waitFor(() => expect(items()[0]).toHaveAttribute('data-kb-middle'));
    expect(items()[0]).not.toHaveAttribute('data-kb-side');
  });

  test('pressing it opens the reveal with six cards and, closed, the hand holds them and no pack', async () => {
    const fake = await world();
    draw(fake);
    const pack = await packButton();
    expect(screen.queryByRole('button', { name: /^Card a/u })).toBeNull();
    fireEvent.click(pack);
    const dialog = await screen.findByRole('dialog', { name: 'Opening a Starter Pack' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn all' }));
    expect(dialog.querySelector('.kb-opening-count')).toHaveTextContent('6 of 6');
    /* A fixed pack has no hit: no gold tag. */
    expect(dialog.querySelector('.kb-opening-tag')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Starter Pack, sealed: open it' })).toBeNull());
    expect(await fake.sealedPacks()).toEqual([]);
    for (const k of KEYS) expect(await screen.findByRole('button', { name: new RegExp(`^Card ${k}`, 'u') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Hand/u })).toHaveTextContent('· 6');
  });

  test('a card of the pack that was withdrawn is shown as the instance\'s back with the refund said plainly, claiming no rarity or alignment', async () => {
    const fake = await world();
    const real = fake.openPack.bind(fake);
    fake.openPack = async (id) => { const a = await real(id); return a.ok ? { ok: true as const, value: { ...a.value, refunds: [{ index: 2, refund: 100 }, { index: 4, refund: 250 }] } } : a; };
    renderIn(fake, <Live />, { instance, packs: packs as never, cardBack: { mark: '/coin.svg' } });
    fireEvent.click(await packButton());
    const dialog = await screen.findByRole('dialog', { name: 'Opening a Starter Pack' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn all' }));
    const row = within(within(dialog).getByRole('list', { name: 'The pack, in the order it was pulled' })).getAllByRole('listitem');
    expect(row[2]).toHaveAccessibleName(/^Card 3: Withdrawn: refunded 1\.00 orb\.(, the card shown)?$/u);
    expect(row[4]).toHaveAccessibleName(/^Card 5: Withdrawn: refunded 2\.50 orbs\.(, the card shown)?$/u);
    expect(row[2]!.querySelector('.kb-postcard-gem, .kb-postcard-tag, .kb-postcard-play')).toBeNull();
    expect(row[2]!.querySelector('.kb-postcard')).not.toHaveAttribute('data-kb-alignment');
    expect(row[2]!.querySelector('.kb-postcard-back')).not.toBeNull();
    expect(row[1]).toHaveAccessibleName(/^Card 2: Card [a-f], Sweet Cast, common/u);
  });

  test('a refused open says why and reads the rows again, so a pack opened elsewhere goes with its message', async () => {
    const fake = await world();
    renderIn(fake, <Given />, { instance, packs: packs as never });
    const pack = await packButton();
    /* Another tab opened it first. */
    await fake.openPack((await fake.sealedPacks())[0]!.pack);
    await act(async () => { fireEvent.click(pack); });
    expect(await screen.findByText('This pack is already open.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Opening/u })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Starter Pack, sealed: open it' })).toBeNull());
  });

  test('an open that throws says so plainly and leaves the pack', async () => {
    const fake = await world();
    renderIn(fake, <Given />, { instance, packs: packs as never });
    const pack = await packButton();
    fake.openPack = async () => { throw new Error('offline'); };
    await act(async () => { fireEvent.click(pack); });
    expect(await screen.findByText('The pack could not be opened. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Starter Pack, sealed: open it' })).toBeInTheDocument();
  });

  test('a double press makes one open', async () => {
    const fake = await world();
    renderIn(fake, <Given />, { instance, packs: packs as never });
    const pack = await packButton();
    const real = fake.openPack.bind(fake);
    let calls = 0;
    fake.openPack = (id) => { calls += 1; return real(id); };
    await act(async () => { fireEvent.click(pack); fireEvent.click(pack); });
    await screen.findByRole('dialog', { name: 'Opening a Starter Pack' });
    expect(calls).toBe(1);
  });

  test('the refusal goes when the sheet closes', async () => {
    const fake = await world();
    function Sheet() {
      const [open, setOpen] = useState(true);
      return <><button type="button" onClick={() => setOpen(!open)}>toggle</button><Hand held={holding} faces={faces} vendingHref="/vending" onClose={() => {}} open={open} /></>;
    }
    renderIn(fake, <Sheet />, { instance, packs: packs as never });
    const pack = await packButton();
    fake.openPack = async () => ({ ok: false as const, error: 'this pack is already open' });
    await act(async () => { fireEvent.click(pack); });
    await screen.findByText('This pack is already open.');
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await waitFor(() => expect(screen.queryByText('This pack is already open.')).toBeNull());
  });

  test('focus after the reveal closes is on the hand\'s first place, not the body', async () => {
    const fake = await world();
    draw(fake);
    fireEvent.click(await packButton());
    const dialog = await screen.findByRole('dialog', { name: 'Opening a Starter Pack' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn all' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('li.kb-hand-card > button')));
    expect(document.activeElement).not.toBe(document.body);
  });

  test('with no sealed pack the hand is the cards alone', async () => {
    const fake = await world(false);
    renderIn(fake, <Given />, { instance, packs: packs as never });
    expect(items()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /sealed/u })).toBeNull();
  });
});
