/**
 * The Hand button's word for sealed packs (the starter pack design, section 6): while any pack is sealed it carries a dot and its name says how many
 * ("Hand, 3 postcards, 1 sealed pack"); with none it is as it was. The Frame is the real one over a stub API, as hand-modal.test.tsx draws it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { KayfaApi, MyCharacter } from '../data/api.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { PlayerProvider } from '../player.tsx';
import { RouterProvider } from '../router.tsx';
import { testGlass } from '../test-world.tsx';
import { forgetBoard } from '../glass/back.ts';
import { Frame } from './Frame.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

const mine = (id: string, name: string): MyCharacter => ({
  id, name, pronouns: ENGINE_DEFAULT_PRONOUNS, class: 'heel', classSince: '2026-10-01T00:00:00Z', classShownAt: null, classDueAt: null, turnOpensAt: null, debutedAt: '2026-10-01T00:00:00Z',
  debutLoudness: 'silent', retiredAt: null, pendingTurn: null, presenceHidden: false,
});

function setup(sealedPacks: () => Promise<unknown[]> = async () => []) {
  const page = <p>page</p>;
  const api = {
    session: async () => ({ signedIn: true, account: 'acc' }),
    onSession: () => () => {},
    myCharacters: async () => [mine('a', 'Pipewrench')],
    wallet: async () => ({ balance: 240, cap: 600 }),
    sealedPacks,
    myCards: async () => [{ card: 'whoops', held: 2 }, { card: 'stick-around', held: 1 }],
    estimate: async () => ({ entries: [], lines: [], asOf: null, freshAfter: null }),
    characters: vi.fn(async () => []),
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
    instance: {
      cards: [
        { key: 'whoops', name: 'Whoops!', alignment: 'salty', rarity: 'common', playPrice: () => 0 },
        { key: 'stick-around', name: 'Stick Around', alignment: 'sweet', rarity: 'common', playPrice: () => 0 },
      ],
      packs: [{ key: 'starter', contents: ['whoops', 'stick-around'] }],
      settings: { economy: { 'whoops.price': 100, 'stick.price': 100 } },
      classes: [{ key: 'face', name: 'Face' }, { key: 'heel', name: 'Heel' }],
    },
    ui: { glass: testGlass, licensing: { source: 'https://example.com/source', terms: 'T', credits: [] }, copy: { siteName: 'Divided World', siteTagline: 'dw.gripe', shopName: 'The Vending Machine', badges: [] }, cards: [], frontDoor: { prompt: { title: 'Who will you play as?', line: 'A test game.' } } },
    settings: { walletCap: 600, registrationMode: 'invite' },
  } as unknown as Kayfa;
  render(
    <RouterProvider>
      <KayfaProvider value={kayfa}>
        <PlayerProvider api={api}><Frame>{page}</Frame></PlayerProvider>
      </KayfaProvider>
    </RouterProvider>,
  );
}

beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); localStorage.clear(); sessionStorage.clear(); forgetBoard(); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); vi.restoreAllMocks(); });

const sealed = (n: number) => async () => Array.from({ length: n }, (_, i) => ({ pack: `p${i}`, kind: 'starter', at: '2026-11-18T00:00:00Z' }));
const dot = () => document.querySelector('.kb-hud-hand .kb-hud-hand-dot');

describe('the Hand button and sealed packs', () => {
  test('with none it is named as it was and has no dot', async () => {
    setup(sealed(0));
    expect(await screen.findByRole('button', { name: 'Hand, 3 postcards' })).toBeInTheDocument();
    expect(dot()).toBeNull();
  });

  test('with one sealed it says so in its name and carries a dot', async () => {
    setup(sealed(1));
    expect(await screen.findByRole('button', { name: 'Hand, 3 postcards, 1 sealed pack' })).toBeInTheDocument();
    expect(dot()).not.toBeNull();
    expect(dot()).toHaveAttribute('aria-hidden', 'true');
  });

  test('with two it says packs', async () => {
    setup(sealed(2));
    expect(await screen.findByRole('button', { name: 'Hand, 3 postcards, 2 sealed packs' })).toBeInTheDocument();
  });
});

describe('the dot follows the rows', () => {
  test('a pack opened takes the dot away, and a character made gives it, with no reload', async () => {
    const { buildWorld, renderIn, testInstance } = await import('../test-world.tsx');
    const { usePlayer } = await import('../player.tsx');
    const instance = { ...testInstance, settings: { ...testInstance.settings, startingPack: 'starter' }, packs: [{ key: 'starter', contents: ['whoops'] }] } as never;
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('ana'));
    function Make() {
      const { refresh } = usePlayer();
      return <button type="button" onClick={async () => { await fake.createCharacter('Ana Face', 'face', 'now', 'silent'); await refresh(); }}>make</button>;
    }
    renderIn(fake, <Frame><Make /></Frame>, { instance });
    const make = await screen.findByRole('button', { name: 'make' });
    expect(dot()).toBeNull();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(make);
    await waitFor(() => expect(dot()).not.toBeNull());
    expect(screen.getByRole('button', { name: /^Hand, 0 postcards, 1 sealed pack/u })).toBeInTheDocument();
    await fake.openPack((await fake.sealedPacks())[0]!.pack);
    fireEvent.click(make);
    await waitFor(() => expect(dot()).toBeNull());
  });
});
