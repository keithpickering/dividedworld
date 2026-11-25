/**
 * A post wearing a live play of a card that covers the row (`CardUi.coversRow`) has the card's `Cover` drawn over its whole row, inside the row's grid, until the reader opens it.
 * The cards here are the engine's own test cards, never an instance's.
 */
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi, CoverProps, EffectProps } from '../cards/types.ts';
import { LoadedThread } from '../loaded.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';

const rules = (key: string, extra: Partial<CardRules> = {}): CardRules => ({
  key, name: key, alignment: 'pepperoni', rarity: 'rare', reaches: ['post'], playPrice: () => 0, validateConfig: (c) => ok(c ?? {}),
  canApply: (t, e, _c, now) => landsOn({ key, reaches: ['post'], ...(extra.stack ? { stack: extra.stack } : {}) }, t, e, now),
  ...extra,
});
const instance: Instance = {
  ...testInstance,
  cards: [...testInstance.cards, rules('curtain', { lasts: { unit: 'day', count: 1 }, stack: 3 }), rules('probe', { lasts: { unit: 'day', count: 1 } }), rules('folder', { lasts: { unit: 'day', count: 1 } })],
};

/* The cover says how many are shut and opens one; the effect says what it was given and shuts them all again. */
const Cover = ({ cover, plays }: CoverProps) => (
  <div data-testid="cover" data-shut={cover.shut} data-plays={plays.length}>
    <button type="button" onClick={cover.open}>open the curtain</button>
  </div>
);
const Curtain = ({ cover, covered, children }: EffectProps) => (
  <div data-testid="fx-curtain" data-covered={String(covered)} data-cover={cover ? `${cover.shut}/${cover.total}` : 'none'}>
    <button type="button" onClick={cover?.encore}>encore</button>
    {children}
  </div>
);
const Probe = ({ covered, children }: EffectProps) => <div data-testid="fx-probe" data-covered={String(covered)}>{children}</div>;
const Fold = ({ children }: EffectProps) => <div data-testid="fx-folder">{children}</div>;
const art = { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = [
  { key: 'curtain', art, describe: () => 'curtain', Effect: Curtain, Cover, coversRow: true },
  { key: 'probe', art, describe: () => 'probe', Effect: Probe },
  { key: 'folder', art, describe: () => 'folder', Effect: Fold, foldsRow: true },
];

function world() {
  const fake = buildWorld(undefined, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const ids = [first, fake.seed.post(thread, pipe, 'post 2'), fake.seed.post(thread, spritey, 'post 3')];
  fake.signInAs(me);
  return { fake, me, other, pipe, spritey, thread, ids };
}
const open = (w: { fake: ReturnType<typeof buildWorld>; thread: string }) =>
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, cards, instance });
const grid = (article: HTMLElement) => article.querySelector<HTMLElement>('.kb-act-grid')!;
const covers = (article: HTMLElement) => article.querySelectorAll<HTMLElement>('.kb-row-cover');
/* Every child of the grid but the cover's host. */
const under = (article: HTMLElement) => [...grid(article).children].filter((el) => !el.classList.contains('kb-row-cover'));

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('a post that wears a card that covers the row', () => {
  test('draws the card\'s Cover over the row, makes the row inert and tells another effect the post is covered', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'curtain');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'probe');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(covers(second)).toHaveLength(1);
    expect(grid(second).contains(covers(second)[0]!)).toBe(true);
    expect(within(covers(second)[0]!).getByTestId('cover')).toHaveAttribute('data-shut', '1');
    const rest = under(second);
    expect(rest.length).toBeGreaterThan(1);
    expect(rest.every((el) => el.hasAttribute('inert'))).toBe(true);
    expect(within(second).getByTestId('fx-probe')).toHaveAttribute('data-covered', 'true');
    expect(within(second).getByTestId('fx-curtain')).toHaveAttribute('data-cover', '1/1');
    /* A post with no such play is drawn as ever. */
    const third = screen.getByRole('article', { name: /^Post 3 by Spritey$/u });
    expect(covers(third)).toHaveLength(0);
    expect(under(third).some((el) => el.hasAttribute('inert'))).toBe(false);
  });

  test('opens on a press: the cover goes, the row is no longer inert and covered is false', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'curtain');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'probe');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(covers(second)).toHaveLength(0);
    expect(under(second).some((el) => el.hasAttribute('inert'))).toBe(false);
    expect(within(second).getByTestId('fx-probe')).toHaveAttribute('data-covered', 'false');
    expect(within(second).getByTestId('fx-curtain')).toHaveAttribute('data-cover', '0/1');
  });

  test('with two plays, the first open leaves one shut and Encore shuts both again', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'curtain');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'curtain');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(within(second).getByTestId('cover')).toHaveAttribute('data-shut', '2');
    expect(within(second).getByTestId('cover')).toHaveAttribute('data-plays', '2');
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(within(second).getByTestId('cover')).toHaveAttribute('data-shut', '1');
    expect(within(second).getByTestId('fx-curtain')).toHaveAttribute('data-covered', 'true');
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(covers(second)).toHaveLength(0);
    await userEvent.click(within(second).getByRole('button', { name: 'encore' }));
    expect(within(second).getByTestId('cover')).toHaveAttribute('data-shut', '2');
    expect(under(second).every((el) => el.hasAttribute('inert'))).toBe(true);
  });

  test('is never stuck when a play is ended: fewer plays than were opened leaves none shut, and a new play shuts one', async () => {
    const w = world();
    w.fake.seed.admin(w.me);
    const a = w.fake.seed.card(w.spritey, w.ids[1]!, 'curtain');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'curtain');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(covers(second)).toHaveLength(0);
    await act(async () => { expect((await w.fake.reverseCard(a)).ok).toBe(true); });
    await waitFor(() => expect(within(second).getByTestId('fx-curtain')).toHaveAttribute('data-cover', '0/1'));
    expect(covers(second)).toHaveLength(0);
    w.fake.seed.cards(w.me, { curtain: 1 });
    await act(async () => { expect((await w.fake.playCard('curtain', w.pipe, w.ids[1]!, {}, '')).ok).toBe(true); });
    await waitFor(() => expect(within(second).getByTestId('cover')).toHaveAttribute('data-shut', '1'));
  });

  test('with a fold too, the fold\'s bar is outside the grid and the cover inside it', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'curtain');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const bar = second.querySelector<HTMLElement>('.kb-fold-bar')!;
    expect(bar).not.toBeNull();
    expect(grid(second).contains(bar)).toBe(false);
    expect(grid(second).contains(covers(second)[0]!)).toBe(true);
    expect(bar.hasAttribute('inert')).toBe(false);
  });
});
