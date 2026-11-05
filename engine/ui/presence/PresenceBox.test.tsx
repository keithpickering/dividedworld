import { act, cleanup, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import type { PresencePlace } from '../data/api.ts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { usePlayer } from '../player.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { PresenceBox } from './PresenceBox.tsx';

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

const HEADING = 'Users browsing this thread';

/** A box whose place moves from a thread to the index at a button's press. */
function Mover({ thread }: { readonly thread: string }) {
  const [place, setPlace] = useState<PresencePlace>({ kind: 'thread', thread });
  return <><PresenceBox place={place} heading={HEADING} /><button type="button" onClick={() => setPlace({ kind: 'index' })}>Move</button></>;
}

/** A button that changes the HUD's mask, as the HUD's own switch does. */
function HudSwitch({ to }: { readonly to: string }) {
  const { setHudCharacter } = usePlayer();
  return <button type="button" onClick={() => setHudCharacter(to)}>Switch the HUD</button>;
}

/** A thread with `others` other players' masks browsing it, each having polled in turn, and the viewer signed in with one mask. */
function crowd(others: readonly string[], o: { hidden?: boolean; presenceNames?: number } = {}) {
  const fake = buildWorld(o.presenceNames === undefined ? undefined : { presenceNames: o.presenceNames } as never);
  const me = fake.seed.account('me');
  const mine = fake.seed.character(me, 'Spritey', 'face');
  const starter = fake.seed.character(fake.seed.account('starter'), 'Starter', 'face');
  const { thread } = fake.seed.thread('general', starter, 'A thread', 'x');
  for (const name of others) {
    const account = fake.seed.account(name.toLowerCase().replace(/\W/gu, ''));
    const c = fake.seed.character(account, name, 'face');
    fake.signInAs(account);
    void fake.here({ kind: 'thread', thread }, c);
    fake.clock.advance(1000);
  }
  fake.signInAs(me);
  if (o.hidden) void fake.setPresenceHidden(mine, true);
  const seeded = { me, mine, thread };
  return { fake, seeded, show: (element: ReactElement) => renderIn(fake, element) };
}

describe('the presence box', () => {
  test('lists the names in order, each linked to its profile, under its heading', async () => {
    const { seeded, show } = crowd(['Pipewrench', 'Mrs. Hooligan']);
    show(<PresenceBox place={{ kind: 'thread', thread: seeded.thread }} heading={HEADING} />);
    const box = await screen.findByRole('region', { name: HEADING });
    await within(box).findByRole('link', { name: 'Spritey' });
    const links = within(box).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Pipewrench', 'Mrs. Hooligan', 'Spritey']);
    expect(links[2]).toHaveAttribute('href', `/c/${seeded.mine}`);
    expect(box).not.toHaveTextContent('other');
  });

  test('past the cap it says how many others; one past says "1 other"', async () => {
    const many = crowd(['A1', 'B2', 'C3', 'D4'], { presenceNames: 2 });
    many.show(<PresenceBox place={{ kind: 'thread', thread: many.seeded.thread }} heading={HEADING} />);
    const box = await screen.findByRole('region', { name: HEADING });
    await vi.waitFor(() => expect(box).toHaveTextContent(/A1, B2 and 3 others$/u));
    cleanup();
    const one = crowd(['A1', 'B2'], { presenceNames: 2 });
    one.show(<PresenceBox place={{ kind: 'thread', thread: one.seeded.thread }} heading={HEADING} />);
    const again = await screen.findByRole('region', { name: HEADING });
    await vi.waitFor(() => expect(again).toHaveTextContent(/A1, B2 and 1 other$/u));
  });

  test('your own hidden mask shows to you alone, in italics, from your own session', async () => {
    const { seeded, show, fake } = crowd(['Pipewrench'], { hidden: true });
    show(<PresenceBox place={{ kind: 'thread', thread: seeded.thread }} heading={HEADING} />);
    const box = await screen.findByRole('region', { name: HEADING });
    const mine = await within(box).findByText('Spritey');
    expect(mine.closest('em')).not.toBeNull();
    expect(box).toHaveTextContent('Spritey (hidden, only you see this)');
    /* Nobody else's render of the place holds it: the server never lists a hidden mask. */
    const other = fake.seed.account('other');
    fake.signInAs(other);
    expect((await fake.here({ kind: 'thread', thread: seeded.thread }, null)).names.map((n) => n.name)).toEqual(['Pipewrench']);
  });

  test('a staff character is listed for the window after its post there, with the group after its name; a player is never given the group', async () => {
    const { seeded, show, fake } = crowd(['Pipewrench']);
    const modbot = fake.seed.staff('bot-a', 'Hall Monitor', 'mod');
    fake.seed.staffPost(modbot, seeded.thread, 'Order.');
    show(<PresenceBox place={{ kind: 'thread', thread: seeded.thread }} heading={HEADING} />);
    const box = await screen.findByRole('region', { name: HEADING });
    await within(box).findByRole('link', { name: 'Hall Monitor' });
    expect(box).toHaveTextContent('Hall Monitor Test Cores');
    expect(box).toHaveTextContent('Pipewrench');
    expect(box).not.toHaveTextContent('Pipewrench Test Cores');
    expect(box).not.toHaveTextContent('Spritey Test Cores');
  });

  test('past the window the staff character is gone', async () => {
    const { seeded, show, fake } = crowd(['Pipewrench']);
    const modbot = fake.seed.staff('bot-a', 'Hall Monitor', 'mod');
    fake.seed.staffPost(modbot, seeded.thread, 'Order.');
    fake.clock.advance(6 * 60_000);
    show(<PresenceBox place={{ kind: 'thread', thread: seeded.thread }} heading={HEADING} />);
    const box = await screen.findByRole('region', { name: HEADING });
    await within(box).findByRole('link', { name: 'Spritey' });
    expect(box).not.toHaveTextContent('Hall Monitor');
  });

  test('is not a live region', async () => {
    const { seeded, show } = crowd(['Pipewrench']);
    show(<PresenceBox place={{ kind: 'thread', thread: seeded.thread }} heading={HEADING} />);
    const box = await screen.findByRole('region', { name: HEADING });
    expect(box.closest('[aria-live]')).toBeNull();
    expect(box.querySelector('[aria-live]')).toBeNull();
  });

  test('renders nothing until the first answer', async () => {
    const { seeded, show, fake } = crowd(['Pipewrench']);
    let answer: () => void = () => {};
    vi.spyOn(fake, 'here').mockImplementation(() => new Promise((resolve) => { answer = () => resolve({ names: [], others: 0 }); }));
    show(<PresenceBox place={{ kind: 'thread', thread: seeded.thread }} heading={HEADING} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
    await act(async () => { answer(); await Promise.resolve(); });
    expect(await screen.findByRole('region', { name: HEADING })).toHaveTextContent('No characters right now.');
  });
});

describe('polling', () => {
  /** The box rendered with the fake's clock under vitest's, `here` watched; resolves once the first poll has answered. */
  async function polling(o: { failing?: boolean } = {}) {
    const world = crowd(['Pipewrench']);
    const here = vi.spyOn(world.fake, 'here');
    if (o.failing) here.mockRejectedValue(new Error('the answer was lost'));
    vi.useFakeTimers();
    world.show(<PresenceBox place={{ kind: 'thread', thread: world.seeded.thread }} heading={HEADING} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    return { ...world, here };
  }
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(50); });

  test('polls again after presencePollSeconds, and through the HUD\'s mask', async () => {
    const { here, seeded } = await polling();
    const before = here.mock.calls.length;
    expect(here).toHaveBeenLastCalledWith({ kind: 'thread', thread: seeded.thread }, seeded.mine);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(here.mock.calls.length).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(here.mock.calls.length).toBe(before + 1);
  });

  test('stops while the tab is hidden, and polls at once when it is shown again', async () => {
    const { here } = await polling();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = here.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(here.mock.calls.length).toBe(hidden);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(here.mock.calls.length).toBe(hidden + 1);
    visibility.mockRestore();
  });

  test('a change of the HUD\'s mask polls at once, through the new mask', async () => {
    const world = crowd(['Pipewrench']);
    const second = world.fake.seed.character(world.seeded.me, 'Sprocket', 'heel');
    const here = vi.spyOn(world.fake, 'here');
    vi.useFakeTimers();
    world.show(<><PresenceBox place={{ kind: 'thread', thread: world.seeded.thread }} heading={HEADING} /><HudSwitch to={second} /></>);
    await settle();
    const before = here.mock.calls.length;
    await act(async () => { screen.getByRole('button', { name: 'Switch the HUD' }).click(); });
    await settle();
    expect(here.mock.calls.length).toBe(before + 1);
    expect(here).toHaveBeenLastCalledWith({ kind: 'thread', thread: world.seeded.thread }, second);
  });

  test('three failed polls in a row remove the box; one does not', async () => {
    const { here } = await polling();
    expect(screen.getByRole('region', { name: HEADING })).toBeInTheDocument();
    const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    here.mockRejectedValueOnce(new Error('lost'));
    await tick();
    expect(screen.getByRole('region', { name: HEADING })).toBeInTheDocument();
    await tick();
    here.mockRejectedValue(new Error('lost'));
    await tick();
    await tick();
    expect(screen.getByRole('region', { name: HEADING })).toBeInTheDocument();
    await tick();
    expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
  });

  test('an answer that comes back after a newer one is dropped', async () => {
    const world = crowd(['Pipewrench']);
    const real = world.fake.here.bind(world.fake);
    const late: (() => void)[] = [];
    let first = true;
    vi.spyOn(world.fake, 'here').mockImplementation(async (place, through) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => { late.push(resolve); });
        return { names: [{ id: 'stale', name: 'Stale', staff: false }], others: 0 };
      }
      return real(place, through);
    });
    vi.useFakeTimers();
    world.show(<PresenceBox place={{ kind: 'thread', thread: world.seeded.thread }} heading={HEADING} />);
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const box = screen.getByRole('region', { name: HEADING });
    expect(box).toHaveTextContent('Pipewrench');
    await act(async () => { late.forEach((r) => r()); await vi.advanceTimersByTimeAsync(10); });
    expect(box).not.toHaveTextContent('Stale');
  });

  test('a page restored from the back-forward cache polls at once', async () => {
    const { here } = await polling();
    const before = here.mock.calls.length;
    await act(async () => { window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })); });
    expect(here.mock.calls.length).toBe(before + 1);
  });

  test('mounted in a hidden tab, it sends nothing; unmounted, it stops', async () => {
    const world = crowd(['Pipewrench']);
    const here = vi.spyOn(world.fake, 'here');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.useFakeTimers();
    const view = world.show(<PresenceBox place={{ kind: 'thread', thread: world.seeded.thread }} heading={HEADING} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(here).not.toHaveBeenCalled();
    visibility.mockRestore();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    const polled = here.mock.calls.length;
    expect(polled).toBeGreaterThan(0);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(here.mock.calls.length).toBe(polled);
  });

  test('signed out, it sends nothing', async () => {
    const world = crowd(['Pipewrench']);
    world.fake.signInAs(null);
    const here = vi.spyOn(world.fake, 'here');
    vi.useFakeTimers();
    world.show(<PresenceBox place={{ kind: 'index' }} heading="Who is online" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(here).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Who is online' })).toBeNull();
  });

  test('a change of place shows nothing of the old place\'s answer while the new one is asked', async () => {
    const world = crowd(['Pipewrench']);
    const real = world.fake.here.bind(world.fake);
    let hold = false;
    vi.spyOn(world.fake, 'here').mockImplementation((place, through) => (hold ? new Promise(() => {}) : real(place, through)));
    vi.useFakeTimers();
    world.show(<Mover thread={world.seeded.thread} />);
    await settle();
    expect(screen.getByRole('region', { name: HEADING })).toHaveTextContent('Pipewrench');
    hold = true;
    await act(async () => { screen.getByRole('button', { name: 'Move' }).click(); });
    await settle();
    expect(screen.queryByRole('region', { name: HEADING })).toBeNull();
  });
});
