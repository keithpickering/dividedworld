/**
 * The write job's late note is the glass's, and an effect fills the post's content area border to border (CLAUDE.md, "An effect fills the post, border to border"):
 * so the note a post with a waiting written play carries stands beside the content area, never in it, in a thread, on the front door and in a spun thread's ORIGIN box.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi } from '../cards/types.ts';
import { createFake } from '../data/fake.ts';
import type { Tail } from '../data/api.ts';
import { KayfaProvider, useKayfa } from '../context.tsx';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { LoadedThread } from '../loaded.tsx';
import { renderIn, testInstance } from '../test-world.tsx';

const base = { alignment: 'salty' as const, rarity: 'common' as const, playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const wrote: CardRules = {
  ...base, key: 'wrote', name: 'wrote', stack: 3, canApply: (t, e, _config, now) => landsOn({ key: 'wrote' }, t, e, now),
  validateState: (s) => ok(s), writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 10, frame: () => ({ prompt: '', stop: [] }) },
};
const instance: Instance = { ...testInstance, cards: [wrote] };
const ui: CardUi = { key: 'wrote', describe: () => 'wrote', art: { color: 'red', ink: 'white', canvas: '', mark: '', credit: 'Test' }, Effect: ({ children }) => <div data-testid="effect">{children}</div> };
const LATE = /^This card's words are late: the job that writes them has not run since .+\. Nothing is lost/u;
const STOPPED = (fake: { seed: { job: (j: string, r: { lastOkAt: string }) => void }; clock: { now: () => number } }) => fake.seed.job('kayfabb-write', { lastOkAt: new Date(fake.clock.now() - 3 * 3_600_000).toISOString() });

afterEach(() => { vi.restoreAllMocks(); Element.prototype.scrollIntoView = vi.fn(); });

function world() {
  const fake = createFake({ instance });
  const me = fake.seed.account('me');
  const mask = fake.seed.character(me, 'Spritey', 'face');
  const opening = fake.seed.thread('general', mask, 'A thread', 'first words');
  fake.signInAs(me);
  return { fake, mask, thread: opening.thread, post: opening.act };
}

describe('the write job\'s late note stands outside the content area', () => {
  test('in a thread', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const w = world();
    w.fake.seed.card(w.mask, w.post, 'wrote');
    STOPPED(w.fake);
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: [ui] });
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(LATE);
    expect(note.closest('[data-kb-content-area]')).toBeNull();
    expect(screen.getByTestId('effect').closest('[data-kb-content-area]')).not.toBeNull();
  });

  test('on the front door', async () => {
    const w = world();
    const tail: Tail = { post: 'front-door:0', play: 'front-door:0:0', version: 'v1', text: null, failed: false, waiting: true, createdAt: null };
    vi.spyOn(w.fake, 'tails').mockResolvedValue([tail]);
    STOPPED(w.fake);
    const Door = () => {
      const k = useKayfa();
      const first = k.ui.frontDoor.posts[0]!;
      return <KayfaProvider value={{ ...k, instance, ui: { ...k.ui, frontDoor: { ...k.ui.frontDoor, posts: [{ ...first, plays: [{ card: 'wrote', by: first.by, config: {} }] }] } } }}><FrontDoor /></KayfaProvider>;
    };
    renderIn(w.fake, <Door />, { instance, cards: [ui] });
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(LATE);
    expect(note.closest('[data-kb-content-area]')).toBeNull();
    expect(screen.getByTestId('effect').closest('[data-kb-content-area]')).not.toBeNull();
  });

  test('in a spun thread\'s ORIGIN box', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const w = world();
    w.fake.seed.card(w.mask, w.post, 'wrote');
    STOPPED(w.fake);
    const made = await w.fake.spin(w.post, w.mask, 'Spun off', 'Elsewhere.');
    if (!made.ok) throw new Error(made.error);
    const spun = made.value.thread.id;
    renderIn(w.fake, <LoadedThread thread={spun} />, { path: `/t/${spun}`, instance, cards: [ui] });
    const box = await screen.findByRole('group', { name: 'Origin' });
    const note = await screen.findByRole('note');
    expect(box).toContainElement(note);
    expect(note).toHaveTextContent(LATE);
    /* The box stands in the spun thread's opening post's body, itself a content area: what matters is the box's own. */
    const area = box.querySelector('[data-kb-content-area]')!;
    expect(area).not.toContainElement(note);
    await waitFor(() => expect(box.querySelector('[data-testid="effect"]')?.closest('[data-kb-content-area]')).not.toBeNull());
  });
});

describe('the write job\'s late note is absent while the job runs, and once the words are written', () => {
  const door = (w: ReturnType<typeof world>, tail: Tail) => {
    vi.spyOn(w.fake, 'tails').mockResolvedValue([tail]);
    const Door = () => {
      const k = useKayfa();
      const first = k.ui.frontDoor.posts[0]!;
      return <KayfaProvider value={{ ...k, instance, ui: { ...k.ui, frontDoor: { ...k.ui.frontDoor, posts: [{ ...first, plays: [{ card: 'wrote', by: first.by, config: {} }] }] } } }}><FrontDoor /></KayfaProvider>;
    };
    renderIn(w.fake, <Door />, { instance, cards: [ui] });
  };
  const waiting: Tail = { post: 'front-door:0', play: 'front-door:0:0', version: 'v1', text: null, failed: false, waiting: true, createdAt: null };
  const written: Tail = { ...waiting, text: 'Written words.', waiting: false };
  const later = () => new Promise((r) => setTimeout(r, 50));

  test('in a thread: the job running, no note; words written, no note', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const running = world();
    running.fake.seed.card(running.mask, running.post, 'wrote');
    renderIn(running.fake, <LoadedThread thread={running.thread} />, { path: `/t/${running.thread}`, instance, cards: [ui] });
    await screen.findByTestId('effect');
    await later();
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    const done = world();
    const play = done.fake.seed.card(done.mask, done.post, 'wrote');
    vi.spyOn(done.fake, 'tails').mockImplementation(async () => [{ post: done.post, play: play as string, version: done.post, text: 'Written words.', failed: false, waiting: false, createdAt: null }]);
    STOPPED(done.fake);
    renderIn(done.fake, <LoadedThread thread={done.thread} />, { path: `/t/${done.thread}`, instance, cards: [ui] });
    await screen.findByTestId('effect');
    await later();
    expect(screen.queryByRole('note')).toBeNull();
  });

  test('on the front door: the job running, no note; words written, no note', async () => {
    const running = world();
    door(running, waiting);
    await screen.findByTestId('effect');
    await later();
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();
    const done = world();
    STOPPED(done.fake);
    door(done, written);
    await screen.findByTestId('effect');
    await later();
    expect(screen.queryByRole('note')).toBeNull();
  });

  test('in a spun thread\'s ORIGIN box: the job running, no note; words written, no note', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    for (const stopped of [false, true]) {
      const w = world();
      const play = w.fake.seed.card(w.mask, w.post, 'wrote');
      if (stopped) STOPPED(w.fake);
      const made = await w.fake.spin(w.post, w.mask, 'Spun off', 'Elsewhere.');
      if (!made.ok) throw new Error(made.error);
      const spun = made.value.thread.id;
      if (stopped) vi.spyOn(w.fake, 'tails').mockImplementation(async () => [{ post: w.post, play: play as string, version: w.post, text: 'Written words.', failed: false, waiting: false, createdAt: null }]);
      renderIn(w.fake, <LoadedThread thread={spun} />, { path: `/t/${spun}`, instance, cards: [ui] });
      const box = await screen.findByRole('group', { name: 'Origin' });
      await waitFor(() => expect(box.querySelector('[data-testid="effect"]')).not.toBeNull());
      await later();
      expect(screen.queryByRole('note')).toBeNull();
      cleanup();
    }
  });
});
