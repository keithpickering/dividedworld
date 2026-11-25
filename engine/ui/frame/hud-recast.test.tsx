/**
 * The HUD's plate recast for another mask (motion.ts `recast`; the owner's choice, 2026-11-20): enter only, in place. When the
 * player swaps masks, the new avatar, name and class line arrive in a short stagger from the side of the list they moved toward
 * (below for a mask after the one left, above for one before), and the plate's edge flares once. Nothing leaves: no copy of the
 * old mask is drawn, so nothing is ever read twice, and the picker is the same element throughout, so the keyboard stays on it.
 * Under Off the swap is instant. The Frame here is the real one over a fake API, as hand-modal.test.tsx draws it.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Character, KayfaApi, MyCharacter } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { PlayerProvider } from '../player.tsx';
import { RouterProvider } from '../router.tsx';
import { testGlass } from '../test-world.tsx';
import { forgetBoard } from '../glass/back.ts';
import { feelTokens } from '../glass/motion.ts';
import { Frame } from './Frame.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

/* jsdom has no WAAPI: Motion's `animate`, which glass/play.ts runs the recast with, is a stub that records each run and holds it until a test settles it. */
interface Run { readonly el: HTMLElement; readonly frames: Record<string, unknown[]>; readonly transition: { readonly delay?: number; readonly type?: string } | undefined; settle: () => void; readonly stop: ReturnType<typeof vi.fn> }
const runs: Run[] = [];
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  animate: (el: HTMLElement, frames: Record<string, unknown[]>, transition?: Run['transition']) => {
    let settle: () => void = () => {};
    const p = new Promise<void>((r) => { settle = r; });
    /* Motion's stop() commits the pose the run had reached: part way in, part faded, part blurred, part cut. */
    const run = { el, frames, transition, settle, stop: vi.fn(() => { el.style.opacity = '0.4'; el.style.transform = 'translateY(6px)'; el.style.filter = 'blur(3px)'; el.style.clipPath = 'inset(0 40% 0 0)'; }) };
    runs.push(run);
    return Object.assign(p, { stop: run.stop });
  },
}));

const mine = (id: string, name: string, cls: string): MyCharacter => ({
  id, name, pronouns: ENGINE_DEFAULT_PRONOUNS, class: cls, classSince: '2026-10-01T00:00:00Z', classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  retiredAt: null, pendingTurn: null, presenceHidden: false,
});

function setup(faces: (ids: readonly string[]) => Promise<readonly Character[]> = async () => []) {
  const api = {
    session: async () => ({ signedIn: true, account: 'acc' }),
    onSession: () => () => {},
    myCharacters: async () => [mine('a', 'Pipewrench', 'heel'), mine('b', 'Mrs. Hooligan', 'face'), mine('c', 'Gutterball', 'heel')],
    wallet: async () => ({ balance: 240, cap: 600 }),
    myCards: async () => [],
    estimate: async () => ({ entries: [], lines: [], asOf: null, freshAfter: null }),
    characters: vi.fn(faces),
    boards: async () => [],
    nextSettlementAt: async () => '2026-10-31T08:17:00Z',
    preferences: async () => ({ tips: 'off', tipsSeen: [] }),
    alertsUnread: async () => 0,
    subscribeAccount: () => () => {},
    subscribeReach: () => () => {},
    actsById: async () => [],
    thread: async () => null,
  } as unknown as KayfaApi;
  const kayfa = {
    api,
    instance: { cards: [], settings: { economy: {} }, classes: [{ key: 'face', name: 'Face' }, { key: 'heel', name: 'Heel' }] },
    ui: { glass: testGlass, copy: { siteName: 'Divided World', siteTagline: 'dw.gripe', shopName: 'The Vending Machine', badges: [] }, cards: [], frontDoor: { prompt: { title: 'Who will you play as?', line: 'A test game.' } } },
    settings: { walletCap: 600, registrationMode: 'invite' },
  } as unknown as Kayfa;
  const view = render(
    <RouterProvider>
      <KayfaProvider value={kayfa}>
        <PlayerProvider api={api}><Frame><p>page</p></Frame></PlayerProvider>
      </KayfaProvider>
    </RouterProvider>,
  );
  return { ...view, api };
}

const root = document.documentElement;
const smoothFeel = () => root.setAttribute('data-kb-motion', 'full');
const snappyFeel = () => { root.setAttribute('data-kb-motion', 'full'); root.setAttribute('data-kb-motion-feel', 'snappy'); };
const phone = () => root.setAttribute('data-kb-text-size', '150');
const plate = () => document.querySelector<HTMLElement>('.kb-hud-plate')!;
const recastRuns = () => runs.filter((r) => plate().contains(r.el));
const ready = async (name: 'Swap mask' | 'Posting as' = 'Swap mask') => {
  const select = await screen.findByRole('combobox', { name });
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
  return select as HTMLSelectElement;
};

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); forgetBoard(); window.history.replaceState(null, '', '/'); });
afterEach(() => {
  runs.length = 0;
  cleanup();
  for (const a of ['data-kb-motion', 'data-kb-motion-feel', 'data-kb-text-size']) root.removeAttribute(a);
  vi.restoreAllMocks();
});

describe('the plate recast for another mask', () => {
  test('nothing plays when the HUD first draws its mask', async () => {
    smoothFeel();
    setup();
    await ready();
    await screen.findByText('Pipewrench', { selector: '.kb-hud-name' });
    expect(recastRuns()).toEqual([]);
    expect(plate()).not.toHaveAttribute('data-kb-recast');
  });

  test('on the Main board the avatar, the name and the class line arrive in that order, from below for a mask after the one left', async () => {
    smoothFeel();
    setup();
    const select = await ready();
    await userEvent.selectOptions(select, 'b');
    const name = await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-name' });
    const played = recastRuns();
    expect(played.map((r) => r.el)).toEqual([plate().querySelector('.kb-hud-avatar'), name, plate().querySelector('.kb-hud-class-line')]);
    for (const r of played) expect((r.frames.y as number[])[0]).toBeGreaterThan(0);
    expect(played.map((r) => r.transition?.delay ?? 0)).toEqual([...played.map((r) => r.transition?.delay ?? 0)].sort((x, y) => x - y));
    expect(played[2]!.transition?.delay).toBeGreaterThan(0);
    /* Smooth comes out of a blur and a fade. */
    expect(played[0]!.frames.opacity).toEqual([0, 1]);
    expect(String((played[0]!.frames.filter as string[])[0])).toMatch(/^blur\(/u);
  });

  test('from above for a mask before the one left', async () => {
    smoothFeel();
    setup();
    const select = await ready();
    await userEvent.selectOptions(select, 'c');
    await screen.findByText('Gutterball', { selector: '.kb-hud-name' });
    runs.length = 0;
    await userEvent.selectOptions(select, 'a');
    await screen.findByText('Pipewrench', { selector: '.kb-hud-name' });
    const played = recastRuns();
    expect(played).toHaveLength(3);
    for (const r of played) expect((r.frames.y as number[])[0]).toBeLessThan(0);
  });

  test('Snappy wipes the parts in along the skew, on its spring', async () => {
    snappyFeel();
    setup();
    const select = await ready();
    await userEvent.selectOptions(select, 'b');
    await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-name' });
    const played = recastRuns();
    expect(played).toHaveLength(3);
    for (const r of played) {
      expect(JSON.stringify(r.frames.clipPath)).toContain('var(--kb-glass-skew)');
      expect(r.transition?.type).toBe('spring');
    }
  });

  test('the picker is the same element throughout and keeps the keyboard, and the old mask is never drawn beside the new', async () => {
    smoothFeel();
    setup();
    const select = await ready();
    select.focus();
    await userEvent.selectOptions(select, 'b');
    await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-name' });
    expect(screen.getByRole('combobox', { name: 'Swap mask' })).toBe(select);
    expect(select).toHaveFocus();
    expect(screen.queryByText('Pipewrench', { selector: '.kb-hud-name' })).toBeNull();
    expect(document.querySelectorAll('.kb-hud-name')).toHaveLength(1);
  });

  test('the plate\'s edge flares once, for as long as the feel says, and the mark goes when the flare ends', async () => {
    smoothFeel();
    setup();
    const select = await ready();
    await userEvent.selectOptions(select, 'b');
    await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-name' });
    const p = plate();
    expect(p).toHaveAttribute('data-kb-recast');
    expect(p.style.getPropertyValue('--kb-hud-recast-ms')).toBe(`${feelTokens('smooth', testGlass.motion).screen}ms`);
    expect(p.style.getPropertyValue('--kb-hud-recast-ease')).toBe(feelTokens('smooth', testGlass.motion).ease);
    p.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(p).not.toHaveAttribute('data-kb-recast');
  });

  test('a swap before the last has landed stops it and gives every part back to its stylesheet before the next plays', async () => {
    smoothFeel();
    setup();
    const select = await ready();
    await userEvent.selectOptions(select, 'b');
    await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-name' });
    const first = recastRuns();
    runs.length = 0;
    await userEvent.selectOptions(select, 'c');
    await screen.findByText('Gutterball', { selector: '.kb-hud-name' });
    for (const r of first) expect(r.stop).toHaveBeenCalled();
    /* The stub's stop() left a pose on each part; the new run starts from the stylesheet, with nothing of it left inline. */
    for (const r of first) {
      expect(r.el.style.clipPath).toBe('');
      expect(r.el.style.transform).toBe('');
    }
    expect(recastRuns()).toHaveLength(3);
  });

  test('a landed part is left with nothing inline', async () => {
    smoothFeel();
    setup();
    const select = await ready();
    await userEvent.selectOptions(select, 'b');
    await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-name' });
    const played = recastRuns();
    for (const r of played) { r.el.style.opacity = '0.7'; r.el.style.filter = 'blur(2px)'; r.settle(); }
    await waitFor(() => { for (const r of played) { expect(r.el.style.opacity).toBe(''); expect(r.el.style.filter).toBe(''); } });
  });

  test('on the Phone board the avatar and the drawn name arrive, the words the phone does not draw do not', async () => {
    smoothFeel();
    phone();
    setup();
    const select = await ready('Posting as');
    await userEvent.selectOptions(select, 'b');
    await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-picked' });
    expect(recastRuns().map((r) => r.el)).toEqual([plate().querySelector('.kb-hud-avatar'), plate().querySelector('.kb-hud-picked')]);
  });

  test('under Off the swap is instant: nothing plays and nothing flares', async () => {
    root.setAttribute('data-kb-motion', 'reduce');
    setup();
    const select = await ready();
    await userEvent.selectOptions(select, 'b');
    await screen.findByText('Mrs. Hooligan', { selector: '.kb-hud-name' });
    expect(recastRuns()).toEqual([]);
    expect(plate()).not.toHaveAttribute('data-kb-recast');
  });
});

/* Each mask's avatar, as its public face carries it; Pipewrench has none. */
const AVATAR: Readonly<Record<string, string | null>> = { a: null, b: 'https://example.test/b.png', c: 'https://example.test/c.png' };
const faceOf = (id: string) => ({ id, name: id, avatarSquare: AVATAR[id] ?? null }) as unknown as Character;

describe('every mask\'s avatar is ready before the first swap', () => {
  /* jsdom loads no images: Image is a stub that records what was asked for and decodes at once. */
  const warmed: string[] = [];
  beforeEach(() => {
    warmed.length = 0;
    vi.stubGlobal('Image', class { decoding = ''; set src(v: string) { warmed.push(v); } decode() { return Promise.resolve(); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('the faces boot does not hold are read in one read for every mask, not one per swap', async () => {
    root.setAttribute('data-kb-motion', 'reduce');
    const { api } = setup(async (ids) => ids.map(faceOf));
    const select = await ready();
    await waitFor(() => expect(api.characters).toHaveBeenCalledTimes(1));
    expect([...(vi.mocked(api.characters).mock.calls[0]![0] as readonly string[])].sort()).toEqual(['a', 'b', 'c']);
    await userEvent.selectOptions(select, 'b');
    await userEvent.selectOptions(select, 'c');
    expect(api.characters).toHaveBeenCalledTimes(1);
  });

  test('each mask\'s avatar is fetched and decoded ahead, once, and a mask with none asks for nothing', async () => {
    root.setAttribute('data-kb-motion', 'reduce');
    setup(async (ids) => ids.map(faceOf));
    const select = await ready();
    await waitFor(() => expect([...warmed].sort()).toEqual([AVATAR.b, AVATAR.c]));
    await userEvent.selectOptions(select, 'b');
    expect([...warmed].sort()).toEqual([AVATAR.b, AVATAR.c]);
  });

  test('the first swap draws the new mask\'s picture in the same commit, never its letter first', async () => {
    root.setAttribute('data-kb-motion', 'reduce');
    setup(async (ids) => ids.map(faceOf));
    const select = await ready();
    await waitFor(() => expect(warmed).toHaveLength(2));
    await userEvent.selectOptions(select, 'c');
    const avatar = plate().querySelector('.kb-hud-avatar')!;
    expect(avatar.querySelector('img')).toHaveAttribute('src', AVATAR.c);
    expect(avatar.querySelector('.kb-avatar-none')).toBeNull();
  });
});
