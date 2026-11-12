/**
 * Card backs, wards and catches on the screens (docs/plans/2026-11-01-card-plays-plan.md, Task 7): a card set face down is one back,
 * named alike for a trap and a Move set beside it to every reader but its setter, and drawn alike to every reader, its setter too, whose Lens
 * names their card (the card template design's amendment of 2026-11-07, "The mark's back"); a Set's and a Use's ghost
 * marks are offered on the reader's own posts alone; and a caught play draws no effect. The cards are the engine's test set.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import type { CardUi, EffectProps } from './types.ts';
import { wordsProblems } from './lens-words.ts';
import { LoadedThread } from '../loaded.tsx';

const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const blot: CardRules = { ...base, key: 'blot', name: 'Blot', alignment: 'salty', rarity: 'common', canApply: (t, e, _config, now) => landsOn({ key: 'blot' }, t, e, now) };
const snare: CardRules = { ...base, key: 'snare', name: 'Snare', alignment: 'salty', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'cast' } }, catches: () => 'blot', canApply: () => ok(undefined) };
/** A common Move, set face down with a Who condition naming only a retired character, so its back looks like a trap's and never springs. */
const dud: CardRules = { ...base, key: 'dud', name: 'Dud', alignment: 'pepperoni', rarity: 'common', canApply: (t, e, _config, now) => landsOn({ key: 'dud' }, t, e, now) };
const instance: Instance = { ...testInstance, cards: [blot, snare, dud], settings: { ...testInstance.settings, economy: { 'x.price': 100 } } };

/** Blot draws a marker around the post's words, so a test sees whether its effect was drawn. */
function Splash({ children }: EffectProps) {
  return <div data-testid="splash">{children}</div>;
}
const art = (color: string) => ({ color, ink: '#000', canvas: '', mark: `/${color}.svg`, credit: 'Test' });
const cards: CardUi[] = [
  { key: 'blot', art: art('pink'), describe: () => 'Splats.', Effect: Splash },
  { key: 'snare', art: art('red'), describe: () => 'Catches a cast.' },
  { key: 'dud', art: art('orange'), describe: () => 'Does nothing.' },
];

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/**
 * Spritey (another player) sets a Snare on post 2 and a Dud on post 3; post 4 is the reader's own. The screens read the time from
 * the browser and the fake dates its Acts on its own clock, so the browser's is set to the fake's: a back's week is counted from the
 * day it was set, never from the day the test runs.
 */
async function world() {
  const fake = buildWorld({ postMaxLength: 1000 }, instance);
  vi.useFakeTimers({ shouldAdvanceTime: true, now: fake.clock.now() });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const trapped = fake.seed.post(thread, spritey, 'post 2');
  const ghost = fake.seed.character(other, 'Ghost', 'face', { retired: true });
  const dudded = fake.seed.post(thread, spritey, 'post 3');
  const mine = fake.seed.post(thread, pipe, 'post 4');
  fake.seed.cards(other, { snare: 1, dud: 1 });
  fake.seed.cards(me, { blot: 2, snare: 1 });
  fake.signInAs(other);
  const set = await fake.setCard('snare', spritey, trapped, {});
  await fake.setCard('dud', spritey, dudded, {}, { who: { except: false, characters: [ghost] } });
  fake.signInAs(me);
  localStorage.setItem(hudKey(me), pipe);
  return { fake, me, other, pipe, spritey, thread, trapped, dudded, mine, set };
}
async function open(w: Awaited<ReturnType<typeof world>>) {
  renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards, cardBack: { mark: '/coin.svg' }, settings: { postMaxLength: 1000 } });
  await screen.findByRole('article', { name: /^Post 4 /u });
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const back = (seq: number) => within(post(seq)).queryByRole('button', { name: /^A card set face down by /u });

describe('a card back', () => {
  test('is named and drawn the same for a trap and a Move set beside it, and its Lens says the same, to any reader but the setter', async () => {
    const w = await world();
    await open(w);
    await waitFor(() => expect(back(2)).not.toBeNull());
    const [trap, dud] = [back(2)!, back(3)!];
    expect(trap.getAttribute('aria-label')).toBe(dud.getAttribute('aria-label'));
    expect(trap.getAttribute('aria-label')).toBe('A card set face down by Spritey, 1 play. Opens the cards on this post.');
    expect(trap.innerHTML).toBe(dud.innerHTML);
    expect(post(2).querySelector('[data-kb-face]')).toBeNull();
    const user = userEvent.setup();
    await user.click(trap);
    const lensOf = async () => {
      const dialog = await screen.findByRole('dialog', { name: 'Cards on this post' });
      return { heading: dialog.querySelector('.kb-lens-line')!.textContent, ends: dialog.querySelector('.kb-lens-ends')!.textContent };
    };
    const said = await lensOf();
    await user.keyboard('{Escape}');
    await user.click(dud);
    expect(await lensOf()).toEqual(said);
    expect(said.heading).toBe('Face down on this post');
    expect(said.ends).toMatch(/^Ends \w+ \d+, [\d:]+\s[AP]M, unless it springs first\.$/u);
  });

  test('whose time passes while its Lens is open is gone from the Lens on the next render, read from the one clock then', async () => {
    const w = await world();
    await open(w);
    await waitFor(() => expect(back(2)).not.toBeNull());
    const user = userEvent.setup();
    await user.click(back(2)!);
    const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
    expect(lens.querySelector('.kb-lens-line')!.textContent).toBe('Face down on this post');
    w.fake.clock.advance(8 * 86_400_000);
    /* A render the Lens has of its own (the fold of Who), with no remount and no read of the plays. */
    await user.click(within(lens).getByRole('button', { name: /^1 play/u }));
    await waitFor(() => expect(screen.queryByText('Face down on this post')).toBeNull());
  });

  test('is the face-down card itself: no picture inside, not even the instance\'s mark, and no card\'s alignment', async () => {
    const w = await world();
    await open(w);
    await waitFor(() => expect(back(2)).not.toBeNull());
    expect(back(2)!.querySelectorAll('img').length).toBe(0);
    expect(back(2)!.getAttribute('data-kb-back')).toBe('down');
    expect(back(2)!.hasAttribute('data-kb-alignment')).toBe(false);
  });

  test('is drawn the same on its setter\'s screen, whose Lens names their card', async () => {
    const w = await world();
    await open(w);
    await waitFor(() => expect(back(2)).not.toBeNull());
    const seen = back(2)!.innerHTML;
    cleanup();
    w.fake.signInAs(w.other);
    await open(w);
    await waitFor(() => expect(back(2)).not.toBeNull());
    /* The setter's own face is loaded (`my_face_down`) before the mark is compared, so a face drawn late cannot pass unseen. */
    const user = userEvent.setup();
    await user.click(back(2)!);
    const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
    await user.click(within(lens).getByRole('button', { name: /^1 play/u }));
    await waitFor(() => expect(lens.textContent).toContain('Yours: Snare, which nobody else can see.'));
    expect(back(2)!.innerHTML).toBe(seen);
    expect(post(2).querySelector('[data-kb-face]')).toBeNull();
  });
});

describe('a card a back laid', () => {
  test('its Lens says who set it, when, and whose quote set it off, above the card\'s own rows', async () => {
    const w = await world();
    const set = w.set.ok ? w.set.value.id : '';
    const spring = w.fake.seed.spring(set, { trigger: 'quote', by: w.mine });
    w.fake.seed.card(w.spritey, w.mine, 'blot', { spring });
    await open(w);
    const mark = await within(post(4)).findByRole('button', { name: /^Blot, 1 play/u });
    const user = userEvent.setup();
    await user.click(mark);
    const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
    await user.click(within(lens).getByRole('button', { name: /^1 play/u }));
    const row = lens.querySelector('.kb-lens-row')!;
    /* Above the card's own rows: the line is the row's first, before the play's by-line. */
    await waitFor(() => expect(row.firstElementChild!.textContent).toMatch(/^Set face down by Spritey on [A-Z][a-z]+ \d+; sprang when Pipewrench quoted it\.$/u));
    expect(row.textContent).not.toMatch(/account/iu);
  });
});

describe('a caught play', () => {
  test('draws no effect, and its mark says it was caught', async () => {
    const w = await world();
    const caught = await w.fake.playCard('blot', w.pipe, w.trapped, {}, '');
    expect(caught.ok && caught.value.payload.caught).toBe(w.set.ok && w.set.value.id);
    await open(w);
    const mark = await within(post(2)).findByRole('button', { name: /^Blot, 1 play/u });
    expect(mark.getAttribute('data-kb-caught')).toBe('true');
    /* The Lens's heading for a caught kind is a short status; what caught it is the play's note (the same for every card kind). */
    const user = userEvent.setup();
    await user.click(mark);
    const lens = await screen.findByRole('dialog', { name: 'Cards on this post' });
    const heading = lens.querySelector('.kb-lens-state .kb-lens-line')!.textContent!;
    expect(heading).toBe('Caught, did nothing');
    expect(wordsProblems('state', heading)).toEqual([]);
    await user.click(within(lens).getByRole('button', { name: /^1 play/u }));
    /* The spring says it caught, and Spritey is a player: the card went to them (read once the row is drawn). */
    await waitFor(() => expect(lens.querySelector('.kb-lens-note')).toHaveTextContent('Caught by a Snare. It did nothing, and its card went to Spritey.'));
    await user.keyboard('{Escape}');
    expect(within(post(2)).queryByTestId('splash')).toBeNull();
    /* The back sprang: it shows the card it was, in its place. */
    expect(post(2).querySelector('[data-kb-back="sprung"]')).not.toBeNull();
    /* A play that was not caught draws its effect. */
    await w.fake.playCard('blot', w.pipe, w.dudded, {}, '');
  });
});

describe('arming a Set', () => {
  test('offers its ghost mark on the reader\'s own posts alone, in the Set\'s words', async () => {
    const w = await world();
    await open(w);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Hand, \d postcards?/u }));
    await user.click(within(screen.getByRole('dialog', { name: 'Your hand' })).getAllByRole('button', { name: /^Snare, Salty, Set/u })[0]!);
    await waitFor(() => expect(within(post(4)).queryByRole('button', { name: 'Set Snare face down on post 4' })).not.toBeNull());
    for (const seq of [1, 2, 3]) expect(within(post(seq)).queryByRole('button', { name: /face down on post/u })).toBeNull();
  });
});
