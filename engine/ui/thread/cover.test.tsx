/**
 * A post wearing a live play of a card that covers the row (`CardUi.coversRow`) has the card's `Cover` drawn over its whole row, inside the row's grid, until the reader opens it.
 * The cards here are the engine's own test cards, never an instance's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi, CoverProps, EffectProps } from '../cards/types.ts';
import { useThread } from './context.ts';
import { LoadedThread } from '../loaded.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';

const rules = (key: string, extra: Partial<CardRules> = {}): CardRules => ({
  key, name: key, alignment: 'pepperoni', rarity: 'rare', reaches: ['post'], playPrice: () => 0, validateConfig: (c) => ok(c ?? {}),
  canApply: (t, e, _c, now) => landsOn({ key, reaches: ['post'], ...(extra.stack ? { stack: extra.stack } : {}) }, t, e, now),
  ...extra,
});
const here = path.dirname(fileURLToPath(import.meta.url));
const instance: Instance = {
  ...testInstance,
  cards: [...testInstance.cards, rules('cover-card', { lasts: { unit: 'day', count: 1 }, stack: 3 }), rules('cover-b', { lasts: { unit: 'day', count: 1 } }), rules('bare', { lasts: { unit: 'day', count: 1 } }), rules('probe', { lasts: { unit: 'day', count: 1 } }), rules('folder', { lasts: { unit: 'day', count: 1 } }), rules('filler', { lasts: { unit: 'day', count: 1 } })],
};

/* The cover says how many are shut and opens one; the effect says what it was given and shuts them all again. */
const Cover = ({ cover, plays }: CoverProps) => (
  <div data-testid="cover" data-shut={cover.shut} data-plays={plays.length} data-first={plays[0]?.id}>
    <button type="button" onClick={cover.open}>open the curtain</button>
  </div>
);
const CoverB = ({ cover }: CoverProps) => (
  <div data-testid="cover-b" data-shut={cover.shut}><button type="button" onClick={cover.open}>open b</button></div>
);
const Curtain = ({ cover, covered, children }: EffectProps) => (
  <div data-testid="fx-curtain" data-covered={String(covered)} data-cover={cover ? `${cover.shut}/${cover.total}` : 'none'}>
    <button type="button" onClick={cover?.encore}>encore</button>
    {children}
  </div>
);
const Probe = ({ covered, children }: EffectProps) => <div data-testid="fx-probe" data-covered={String(covered)}>{children}</div>;
const Fill = ({ covered, children }: EffectProps) => <div data-testid="fx-fill" data-covered={String(covered)} data-thread={useThread().thread}>{children}</div>;
const Fold = ({ children }: EffectProps) => <div data-testid="fx-folder">{children}</div>;
const art = { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = [
  { key: 'cover-card', art, describe: () => 'cover-card', Effect: Curtain, Cover, coversRow: true },
  { key: 'cover-b', art, describe: () => 'b', Effect: Probe, Cover: CoverB, coversRow: true },
  { key: 'bare', art, describe: () => 'bare', Effect: Probe, coversRow: true },
  { key: 'probe', art, describe: () => 'probe', Effect: Probe },
  { key: 'folder', art, describe: () => 'folder', Effect: Fold, foldsRow: true },
  { key: 'filler', art, describe: () => 'filler', Effect: Fill, fillsRow: true },
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
const open = (w: { fake: ReturnType<typeof buildWorld>; thread: string }, rowOrder: readonly string[] = ['cover-b', 'cover-card', 'bare', 'filler']) =>
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, cards, instance, rowOrder });
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
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
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
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
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
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
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
    const a = w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(covers(second)).toHaveLength(0);
    await act(async () => { expect((await w.fake.reverseCard(a)).ok).toBe(true); });
    await waitFor(() => expect(within(second).getByTestId('fx-curtain')).toHaveAttribute('data-cover', '0/1'));
    expect(covers(second)).toHaveLength(0);
    w.fake.seed.cards(w.me, { 'cover-card': 1 });
    await act(async () => { expect((await w.fake.playCard('cover-card', w.pipe, w.ids[1]!, {}, '')).ok).toBe(true); });
    await waitFor(() => expect(within(second).getByTestId('cover')).toHaveAttribute('data-shut', '1'));
  });

  test('a play ended while it is the only one shut takes the host away and lifts the inert', async () => {
    const w = world();
    w.fake.seed.admin(w.me);
    const a = w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(covers(second)).toHaveLength(1);
    await act(async () => { expect((await w.fake.reverseCard(a)).ok).toBe(true); });
    await waitFor(() => expect(covers(second)).toHaveLength(0));
    expect(under(second).some((el) => el.hasAttribute('inert'))).toBe(false);
  });

  test('inert is only what the cover marked: a cell already inert stays so, and a cell added while shut becomes inert', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const fresh = document.createElement('div');
    const already = document.createElement('div');
    already.setAttribute('inert', '');
    grid(second).append(fresh, already);
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(fresh.hasAttribute('inert')).toBe(true);
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(covers(second)).toHaveLength(0);
    expect(fresh.hasAttribute('inert')).toBe(false);
    expect(already.hasAttribute('inert')).toBe(true);
  });

  test('a covering card with no Cover never makes the post inert', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'bare');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(covers(second)).toHaveLength(0);
    expect(under(second).some((el) => el.hasAttribute('inert'))).toBe(false);
  });

  test('a play landing after the reader opened two shuts only the new one, and the Cover is given it first', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const first = () => within(second).getByTestId('cover').getAttribute('data-first');
    const b = first();
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    const a = first();
    expect(a).not.toBe(b);
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(covers(second)).toHaveLength(0);
    w.fake.seed.cards(w.me, { 'cover-card': 1 });
    await act(async () => { expect((await w.fake.playCard('cover-card', w.pipe, w.ids[1]!, {}, '')).ok).toBe(true); });
    await waitFor(() => expect(within(second).getByTestId('cover')).toHaveAttribute('data-shut', '1'));
    expect(within(second).getByTestId('cover')).toHaveAttribute('data-plays', '1');
    expect(within(second).getByTestId('cover').getAttribute('data-first')).not.toBe(a);
    expect(within(second).getByTestId('cover').getAttribute('data-first')).not.toBe(b);
  });

  test('two covering cards stacked draw the outermost card\'s Cover first by the instance\'s order, then the one under it', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-b');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(within(second).getByTestId('cover-b')).toHaveAttribute('data-shut', '2');
    expect(within(second).queryByTestId('cover')).toBeNull();
    await userEvent.click(within(second).getByRole('button', { name: 'open b' }));
    expect(within(second).queryByTestId('cover-b')).toBeNull();
    expect(within(second).getByTestId('cover')).toHaveAttribute('data-shut', '1');
    expect(within(second).getByTestId('cover')).toHaveAttribute('data-plays', '1');
  });

  test('with a fold too, the fold\'s bar is outside the grid and the cover inside it', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'folder');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const bar = second.querySelector<HTMLElement>('.kb-fold-bar')!;
    expect(bar).not.toBeNull();
    expect(grid(second).contains(bar)).toBe(false);
    expect(grid(second).contains(covers(second)[0]!)).toBe(true);
    expect(bar.hasAttribute('inert')).toBe(false);
  });
});

describe('the row\'s layers are in the instance\'s order (InstanceUi.rowOrder)', () => {
  const layer = (article: HTMLElement) => article.querySelector<HTMLElement>('.kb-row-layer');

  test('the cover shown first is the outermost by rank, not the latest played', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-b');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w, ['cover-b', 'cover-card']);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(within(second).getByTestId('cover-b')).toBeInTheDocument();
    expect(within(second).queryByTestId('cover')).toBeNull();
    await userEvent.click(within(second).getByRole('button', { name: 'open b' }));
    expect(within(second).getByTestId('cover')).toBeInTheDocument();
  });

  test('ranked the other way, the latest played of them is still the one shown last', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-b');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w, ['cover-card', 'cover-b']);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(within(second).getByTestId('cover')).toBeInTheDocument();
    expect(within(second).queryByTestId('cover-b')).toBeNull();
  });

  test('a card that fills the row is drawn in a layer in the row\'s grid and not around the words, and makes nothing inert', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'filler');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(layer(second)).not.toBeNull());
    const fill = within(second).getByTestId('fx-fill');
    expect(layer(second)!.parentElement).toBe(grid(second));
    expect(layer(second)!.contains(fill)).toBe(true);
    expect(fill.querySelector('[data-kb-words-box]')).toBeNull();
    expect(second.querySelector('[data-kb-words-box]')!.closest('[data-testid="fx-fill"]')).toBeNull();
    expect(fill).toHaveAttribute('data-covered', 'false');
    expect([...grid(second).children].some((el) => el.hasAttribute('inert'))).toBe(false);
  });

  test('a shut cover ranked outside it keeps the fill covered until it is opened', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'filler');
    open(w, ['cover-card', 'filler']);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(within(second).getByTestId('fx-fill')).toHaveAttribute('data-covered', 'true'));
    expect(layer(second)).toHaveAttribute('data-kb-covered', 'true');
    expect(layer(second)).toHaveAttribute('inert');
    await userEvent.click(within(second).getByRole('button', { name: 'open the curtain' }));
    expect(within(second).getByTestId('fx-fill')).toHaveAttribute('data-covered', 'false');
    expect(layer(second)).not.toHaveAttribute('inert');
  });

  test('a cover ranked inside the fill does not cover it', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'filler');
    open(w, ['filler', 'cover-card']);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(layer(second)).not.toBeNull());
    expect(within(second).getByTestId('fx-fill')).toHaveAttribute('data-covered', 'false');
    expect(layer(second)).not.toHaveAttribute('inert');
  });

  const z = (el: Element | null) => Number((el as HTMLElement).style.zIndex);
  test('the stacking follows rank: a fill ranked outside a cover is drawn over it, and one inside it under it', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    w.fake.seed.card(w.spritey, w.ids[1]!, 'filler');
    const first = open(w, ['filler', 'cover-card']);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(layer(second)).not.toBeNull());
    expect(z(layer(second))).toBeGreaterThan(z(covers(second)[0]!));
    first.unmount();
    open(w, ['cover-card', 'filler']);
    const again = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(layer(again)).not.toBeNull());
    expect(z(layer(again))).toBeLessThan(z(covers(again)[0]!));
  });

  /* An over-ink box (the ORIGIN box, spin/Origin.tsx) stands over the row's fill layers (issue #1275). jsdom cannot composite, so the contract the browser stacks by is asserted: the grid names the box's level
     (`--kb-over-z`), it is over every layer and under a shut cover, and the CSS that uses it takes the body out of its own stacking context (else the level is trapped inside the body, under the layers). */
  const overZ = (article: HTMLElement) => Number(grid(article).style.getPropertyValue('--kb-over-z'));
  test('with a fill layer up, the grid\'s over-ink level is above the layer; with a cover shut it is under the cover and over the layers ranked inside it', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'filler');
    const first = open(w, ['filler', 'cover-card']);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(layer(second)).not.toBeNull());
    expect(overZ(second)).toBeGreaterThan(z(layer(second)));
    first.unmount();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'cover-card');
    open(w, ['cover-card', 'filler']);
    const again = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(covers(again).length).toBe(1));
    expect(overZ(again), 'under the shut cover').toBeLessThan(z(covers(again)[0]!));
    expect(overZ(again), 'over the layer ranked inside the cover').toBeGreaterThan(z(layer(again)));
  });

  test('a row with no fill layer names no over-ink level', async () => {
    const w = world();
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    expect(grid(second).style.getPropertyValue('--kb-over-z')).toBe('');
  });

  test('the CSS lifts the ORIGIN box by that level and frees the body of its stacking context only where a layer is up', () => {
    const fold = fs.readFileSync(path.resolve(here, 'fold.css'), 'utf8').replace(/\s+/gu, ' ');
    expect(fold).toMatch(/\.kb-act-grid:has\(> \.kb-row-layer\) > \.kb-act-main \{[^}]*isolation: auto;[^}]*z-index: auto;/u);
    expect(fold).toMatch(/\.kb-act-grid:has\(> \.kb-row-layer\) \.kb-origin\[data-kb-over-ink\] \{[^}]*z-index: var\(--kb-over-z\);/u);
  });

  test('a fill\'s play ending removes its layer', async () => {
    const w = world();
    w.fake.seed.admin(w.me);
    const a = w.fake.seed.card(w.spritey, w.ids[1]!, 'filler');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(within(second).getByTestId('fx-fill')).toBeInTheDocument());
    await act(async () => { expect((await w.fake.reverseCard(a)).ok).toBe(true); });
    await waitFor(() => expect(layer(second)).toBeNull());
    expect(within(second).queryByTestId('fx-fill')).toBeNull();
  });

  test('a layer appearing does not remount the words', async () => {
    const w = world();
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    const words = second.querySelector('[data-kb-words-box]')!;
    w.fake.seed.cards(w.me, { filler: 1 });
    await act(async () => { expect((await w.fake.playCard('filler', w.pipe, w.ids[1]!, {}, '')).ok).toBe(true); });
    await waitFor(() => expect(layer(second)).not.toBeNull());
    expect(second.querySelector('[data-kb-words-box]')).toBe(words);
    expect(words.isConnected).toBe(true);
  });

  test('the effect in a layer reads the contexts the post provides', async () => {
    const w = world();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'filler');
    open(w);
    const second = await screen.findByRole('article', { name: /^Post 2 by Pipewrench$/u });
    await waitFor(() => expect(within(second).getByTestId('fx-fill')).toHaveAttribute('data-thread', w.thread));
  });
});
