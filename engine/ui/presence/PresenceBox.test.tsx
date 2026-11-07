import { act, cleanup, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import type { PresencePlace } from '../data/api.ts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { usePlayer } from '../player.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { axeViolations, describeViolations } from '../a11y.ts';
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
    expect(box).toHaveTextContent('Hall Monitor, Test Cores');
    expect(within(box).getByText((_, el) => el?.textContent === ', ' && el.tagName === 'SPAN')).toHaveClass('kb-visually-hidden');
    expect(box).toHaveTextContent('Pipewrench');
    expect(box).not.toHaveTextContent('Pipewrench Test Cores');
    expect(box).not.toHaveTextContent('Spritey Test Cores');
  });

  describe('a Mod on a visit (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/04-presence.png)', () => {
    /** The Clerk visits post 2 of the thread, with no post of its own there. */
    function visiting() {
      const w = crowd(['Pipewrench']);
      const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
      const post = w.fake.seed.post(w.seeded.thread, w.fake.seed.character(w.fake.seed.account('writer'), 'Writer', 'face'), 'post 2');
      const visit = w.fake.seed.visit(clerk, post, { at: Date.now(), endsInMs: 3_600_000 });
      return { ...w, clerk, post, visit };
    }

    test('is listed with a glass tag, "On a visit · post #2", linking to the post, though it never posted', async () => {
      const w = visiting();
      w.show(<PresenceBox place={{ kind: 'thread', thread: w.seeded.thread }} heading={HEADING} />);
      const box = await screen.findByRole('region', { name: HEADING });
      const tag = await within(box).findByRole('link', { name: 'On a visit · post #2' });
      expect(tag).toHaveClass('kb-presence-visit');
      expect(tag).toHaveAttribute('href', `/t/${w.seeded.thread}?page=1#post-2`);
      expect(box).toHaveTextContent('The Clerk, Test Cores');
      /* The tag follows the Mod's name, in the Mod's own entry, and no player's name carries one. */
      const clerk = within(box).getByRole('link', { name: 'The Clerk' });
      expect(clerk.parentElement).toContainElement(tag);
      expect(within(box).getAllByRole('link', { name: /^On a visit/u })).toHaveLength(1);
    });

    test('is one name where the Mod also posted, and the tag goes when the visit ends', async () => {
      const w = visiting();
      w.fake.seed.staffPost(w.clerk, w.seeded.thread, 'Order.');
      w.show(<PresenceBox place={{ kind: 'thread', thread: w.seeded.thread }} heading={HEADING} />);
      const box = await screen.findByRole('region', { name: HEADING });
      await within(box).findByRole('link', { name: 'On a visit · post #2' });
      expect(within(box).getAllByRole('link', { name: 'The Clerk' })).toHaveLength(1);
      w.fake.seed.visitEnd(w.visit, { outcome: 'reversed', line: '' });
      await vi.waitFor(async () => expect(await w.fake.presenceBox({ kind: 'thread', thread: w.seeded.thread })).toMatchObject({ names: expect.not.arrayContaining([expect.objectContaining({ visitPost: expect.anything() })]) }));
    });

    test('is not in a board\'s or the index\'s box, which name no post', async () => {
      const w = visiting();
      expect((await w.fake.presenceBox({ kind: 'index' })).names.some((n) => n.visitPost !== undefined)).toBe(false);
      const board = (await w.fake.thread(w.seeded.thread))!.board;
      expect((await w.fake.presenceBox({ kind: 'board', board })).names.some((n) => n.visitPost !== undefined)).toBe(false);
    });

    test('passes axe, and the tag is a link a keyboard reaches', async () => {
      const w = visiting();
      w.show(<PresenceBox place={{ kind: 'thread', thread: w.seeded.thread }} heading={HEADING} />);
      const box = await screen.findByRole('region', { name: HEADING });
      const tag = await within(box).findByRole('link', { name: 'On a visit · post #2' });
      const bad = await axeViolations(box);
      expect(bad, describeViolations(bad)).toEqual([]);
      tag.focus();
      expect(tag).toHaveFocus();
    });
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

/* The page document's snapshot (the forum-load design, section 4): shown at once with the reader's own mask added, until the heartbeat answers. */
describe('a snapshot from the page\'s document', () => {
  const place = (thread: string) => ({ kind: 'thread', thread }) as const;

  test('shows at once, with the HUD\'s mask added at the end of the names, before any heartbeat has answered', async () => {
    const { fake, seeded } = crowd(['Pipewrench', 'Mrs. Hooligan']);
    const boot = await fake.boot();
    const snapshot = await fake.presenceBox(place(seeded.thread));
    vi.spyOn(fake, 'here').mockImplementation(() => new Promise(() => {}));
    renderIn(fake, <PresenceBox place={place(seeded.thread)} heading={HEADING} snapshot={snapshot} />, { boot });
    const box = screen.getByRole('region', { name: HEADING });
    expect(within(box).getAllByRole('link').map((a) => a.textContent)).toEqual(['Pipewrench', 'Mrs. Hooligan', 'Spritey']);
  });

  test('the first heartbeat\'s answer replaces it, and a mask it already lists is not added twice', async () => {
    const { fake, seeded } = crowd(['Pipewrench']);
    const boot = await fake.boot();
    const snapshot = await fake.presenceBox(place(seeded.thread));
    renderIn(fake, <PresenceBox place={place(seeded.thread)} heading={HEADING} snapshot={snapshot} />, { boot });
    const box = await screen.findByRole('region', { name: HEADING });
    await vi.waitFor(() => expect(within(box).getAllByRole('link').map((a) => a.textContent)).toEqual(['Pipewrench', 'Spritey']));
    /* A snapshot that already lists the mask shows it once. */
    cleanup();
    const listed = await fake.here(place(seeded.thread), seeded.mine);
    vi.spyOn(fake, 'here').mockImplementation(() => new Promise(() => {}));
    renderIn(fake, <PresenceBox place={place(seeded.thread)} heading={HEADING} snapshot={listed} />, { boot });
    expect(within(screen.getByRole('region', { name: HEADING })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Pipewrench', 'Spritey']);
  });

  test('is not added when the mask\'s presence is hidden: the box draws it in italics itself, once', async () => {
    const { fake, seeded } = crowd(['Pipewrench'], { hidden: true });
    const boot = await fake.boot();
    const snapshot = await fake.presenceBox(place(seeded.thread));
    vi.spyOn(fake, 'here').mockImplementation(() => new Promise(() => {}));
    renderIn(fake, <PresenceBox place={place(seeded.thread)} heading={HEADING} snapshot={snapshot} />, { boot });
    const box = screen.getByRole('region', { name: HEADING });
    expect(within(box).getAllByRole('link').map((a) => a.textContent)).toEqual(['Pipewrench', 'Spritey']);
    expect(box.querySelectorAll('em')).toHaveLength(1);
    expect(box).toHaveTextContent('Spritey (hidden, only you see this)');
  });

  test('a full box counts the mask among the others, as the first heartbeat would', async () => {
    const { fake, seeded } = crowd(['A1', 'B2', 'C3', 'D4'], { presenceNames: 2 });
    const boot = await fake.boot();
    const snapshot = await fake.presenceBox(place(seeded.thread));
    expect(snapshot).toMatchObject({ others: 2 });
    vi.spyOn(fake, 'here').mockImplementation(() => new Promise(() => {}));
    renderIn(fake, <PresenceBox place={place(seeded.thread)} heading={HEADING} snapshot={snapshot} />, { boot });
    expect(screen.getByRole('region', { name: HEADING })).toHaveTextContent(/A1, B2 and 3 others$/u);
  });

  test('signed out, a snapshot shows nothing', () => {
    const fake = buildWorld();
    renderIn(fake, <PresenceBox place={{ kind: 'index' }} heading="Who is online" snapshot={{ names: [{ id: 'x', name: 'Ghost', staff: false }], others: 0 }} />);
    expect(screen.queryByRole('region', { name: 'Who is online' })).toBeNull();
  });
});
