/**
 * Cards beyond a post, as stories for the owner's word (docs/plans/2026-11-01-card-reach-plan.md, Task 8), on the boards fixture's
 * thread at the Main board's moment:
 *   - `Character`: a card cast on #41's author: its mark on every postbit of theirs in view, and its effect on each of their posts;
 *   - `CharacterStill`: the same under reduced motion, every effect held still;
 *   - `ArmedCharacter`: that card armed: its ghost on each postbit it can land on, never on a post's own strip;
 *   - `Thread`: a card cast on the thread: its mark on the thread's head;
 *   - `Banner`: the engine's own test board card on the thread's board: its mark on the board's banner;
 *   - `Pinned`: a thread card that pins, on the board's list: the thread above page 1's rows, with its mark.
 * Each has its `Phone` twin at 390 by 844; open the others at 1440 by 1120.
 *
 * The story names no instance: the cards are the instance's first character card and its first thread card (one that pins, for
 * `Pinned`), found by their rules; the board card is the engine's own, since no instance ships one yet (Minus World waits for its own
 * screen design).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { KayfaProvider, useKayfa, type Kayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { BoardScreen } from '../board/Board.tsx';
import { useLocation } from '../router.tsx';
import { usePlayer } from '../player.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { landsOn, ok, reachesOf, type CardRules } from '../../rules/cards.ts';
import { usePlay } from './play.tsx';
import type { CardUi } from './types.ts';
import { LoadedBoard, LoadedThread } from '../loaded.tsx';

type Scene = 'character' | 'still' | 'armed' | 'thread' | 'banner' | 'pinned';

/** The engine's own board card, for the banner: legendary, a day, drawn as a plain mark in the glass's neon. */
const RUMBLE: CardRules = {
  key: 'kb-test-rumble', name: 'Rumble', alignment: 'salty', rarity: 'legendary', reaches: ['board'], lasts: { unit: 'day', count: 1 },
  playPrice: () => 0, validateConfig: (c) => ok(c), canApply: (t, e, _config, now) => landsOn({ key: 'kb-test-rumble', reaches: ['board'] }, t, e, now),
};
const RUMBLE_UI: CardUi = { key: 'kb-test-rumble', art: { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)', canvas: '', mark: '', tagline: 'Shake a board.', credit: 'Test' }, describe: () => 'The engine\'s test board card.' };

const DAY = 86_400_000;

/** Lay the scene on the fixture's thread, then say which board it is on, for a scene drawn on the board. */
function useSeeded(thread: string | null, scene: Scene): { readonly ready: boolean; readonly board: string | null } {
  const { api, instance } = useKayfa();
  const [state, setState] = useState<{ ready: boolean; board: string | null }>({ ready: false, board: null });
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      for (const c of instance.cards) await api.meetCard(c.key);
      const acts = await api.acts(thread, 41, 42);
      const target = acts.find((a) => a.seq === 41);
      const caster = acts.find((a) => a.seq === 42)?.character;
      if (!target?.character || !caster) throw new Error('the boards fixture has no #41 and #42 with authors');
      const summary = await api.thread(thread);
      const slug = (await api.boards()).find((b) => b.id === summary?.board)?.slug ?? null;
      const onCharacter = instance.cards.find((c) => reachesOf(c).includes('character'));
      const onThread = instance.cards.find((c) => reachesOf(c).includes('thread') && (scene !== 'pinned' || c.pins));
      const ends = Date.now() + 5 * DAY;
      if ((scene === 'character' || scene === 'still') && onCharacter) fake.seed.reach(caster, 'character', target.character, onCharacter.key, { post: target.id, ends, message: 'Shine on.' });
      if ((scene === 'thread' || scene === 'pinned') && onThread) fake.seed.reach(caster, 'thread', thread, onThread.key, { ends: Date.now() + 20 * 3_600_000, message: 'Everyone, look.' });
      if (scene === 'banner' && summary) fake.seed.reach(caster, 'board', summary.board, RUMBLE.key, { ends: Date.now() + 20 * 3_600_000 });
      if (scene === 'armed' && onCharacter) {
        const me = (await api.session()).account;
        if (me) fake.seed.cards(me, { [onCharacter.key]: 1 });
      }
      if (live) setState({ ready: true, board: slug });
    })().catch((e: unknown) => { console.error('the reach story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, scene]);
  return state;
}

/** Arms the instance's first character card, as the player's press in the hand does. */
function ArmCharacter() {
  const { instance } = useKayfa();
  const play = usePlay();
  const account = usePlayer().session.account;
  const key = instance.cards.find((c) => reachesOf(c).includes('character'))?.key ?? null;
  useEffect(() => {
    if (!play || key === null || account === null) return;
    play.arm(key);
    // Armed once for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, account]);
  return null;
}

/** Holds motion reduced for the story, as the player's setting does, and lets it go after. */
function Still() {
  useEffect(() => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    return () => document.documentElement.removeAttribute('data-kb-motion');
  }, []);
  return null;
}

/** Scrolls #41 to the middle of the window once the thread has drawn it. */
function Look() {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.getElementById('post-41');
      if (!el) return;
      clearInterval(timer);
      el.scrollIntoView?.({ block: 'center' });
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

function Scene({ scene }: { readonly scene: Scene }) {
  const kayfa = useKayfa();
  /* The engine's test board card beside the instance's own, for the banner alone. */
  const withRumble = useMemo<Kayfa>(() => ({
    ...kayfa,
    instance: { ...kayfa.instance, cards: [...kayfa.instance.cards, RUMBLE], settings: { ...kayfa.instance.settings, economy: kayfa.instance.settings.economy }, machine: [...kayfa.instance.machine, { item: { card: RUMBLE.key }, availability: 'onSale' as const, price: 100 }] },
    ui: { ...kayfa.ui, cards: [...kayfa.ui.cards, RUMBLE_UI] },
  }), [kayfa]);
  return <KayfaProvider value={withRumble}><Drawn scene={scene} /></KayfaProvider>;
}

function Drawn({ scene }: { readonly scene: Scene }) {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const { ready, board } = useSeeded(thread, scene);
  const onBoard = scene === 'banner' || scene === 'pinned';
  return (
    <Frame>
      {scene === 'armed' && <ArmCharacter />}
      {scene === 'still' && <Still />}
      {!onBoard && <Look />}
      {!thread || !ready ? <div aria-busy="true" /> : onBoard && board ? <LoadedBoard slug={board} /> : <LoadedThread thread={thread} />}
    </Frame>
  );
}

const meta: Meta<typeof Scene> = {
  title: 'Boards/01 Cards beyond a post',
  component: Scene,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Scene>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** A card cast on #41's author: a mark on each of their postbits, its effect on each of their posts. */
export const Character: Story = { args: { scene: 'character' } };
/** The same, with motion reduced: the effect holds still. */
export const CharacterStill: Story = { args: { scene: 'still' } };
/** The character card armed: its ghost on every postbit it can land on. */
export const ArmedCharacter: Story = { args: { scene: 'armed' } };
/** A card cast on the thread: a mark on its head. */
export const Thread: Story = { args: { scene: 'thread' } };
/** The engine's test board card on the thread's board: a mark on its banner. */
export const Banner: Story = { args: { scene: 'banner' } };
/** A thread card that pins: the thread above page 1 of its board, with its mark. */
export const Pinned: Story = { args: { scene: 'pinned' } };
export const CharacterPhone: Story = { args: { scene: 'character' }, ...phone };
export const CharacterStillPhone: Story = { args: { scene: 'still' }, ...phone };
export const ArmedCharacterPhone: Story = { args: { scene: 'armed' }, ...phone };
export const ThreadPhone: Story = { args: { scene: 'thread' }, ...phone };
export const BannerPhone: Story = { args: { scene: 'banner' }, ...phone };
export const PinnedPhone: Story = { args: { scene: 'pinned' }, ...phone };
