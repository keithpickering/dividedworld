/**
 * A post under a no-quote card (docs/plans/2026-11-11-card-notes-part-4-plan.md, Task 5), on the boards fixture's thread at the Main
 * board's moment: `NoQuotePost` has #41 under a live no-quote play, so it has no Quote link while #42 beside it does, and its mark and Lens
 * say why. Open it at 1440 by 1120, and its `Phone` twin at 390 by 844; light and dark are the board match's two themes.
 *
 * The story names no instance: the card is the engine's own test card, whose one gimmick is `{ kind: 'noQuote' }`, since the story must show
 * the effect whatever the instance ships.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { ok, type CardRules } from '../../rules/cards.ts';
import { KayfaProvider, useKayfa, type Kayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { useLocation } from '../router.tsx';
import type { CardUi } from './types.ts';

/** The engine's own no-quote card: a use card, uncommon, a week, drawn as a plain mark in the glass's neon. */
const STOPPER: CardRules = {
  key: 'kb-test-no-quote', name: 'No Quote', alignment: 'salty', rarity: 'uncommon', play: 'use', gimmick: { kind: 'noQuote' }, lasts: { unit: 'day', count: 7 },
  playPrice: () => 0, validateConfig: (c) => ok(c), canApply: () => ok(undefined),
};
const STOPPER_UI: CardUi = { key: STOPPER.key, art: { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)', canvas: '', mark: '', tagline: 'Say it once.', credit: 'Test' }, describe: () => 'The engine\'s test no-quote card.' };

/** Lay the play on #41, then say the thread is ready to be read. */
function useSeeded(thread: string | null): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      for (const c of instance.cards) await api.meetCard(c.key);
      await api.meetCard(STOPPER.key);
      const acts = await api.acts(thread, 41, 42);
      const target = acts.find((a) => a.seq === 41);
      const caster = acts.find((a) => a.seq === 42)?.character;
      if (!target || !caster) throw new Error('the boards fixture has no #41 and #42 with authors');
      fake.seed.card(caster, target.id, STOPPER.key, { ends: new Date(Date.now() + 5 * 86_400_000).toISOString() });
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the no-quote story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread]);
  return ready;
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

function Drawn() {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread);
  return (
    <Frame>
      <Look />
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

function Scene() {
  const kayfa = useKayfa();
  const withStopper = useMemo<Kayfa>(() => ({
    ...kayfa,
    instance: { ...kayfa.instance, cards: [...kayfa.instance.cards, STOPPER] },
    ui: { ...kayfa.ui, cards: [...kayfa.ui.cards, STOPPER_UI] },
  }), [kayfa]);
  return <KayfaProvider value={withStopper}><Drawn /></KayfaProvider>;
}

const meta: Meta<typeof Scene> = { title: 'Boards/01 No-quote post', component: Scene, parameters: { moment: '01-main', layout: 'fullscreen' } };
export default meta;

type Story = StoryObj<typeof Scene>;

/** #41 under a live no-quote play: no Quote link, its mark, and #42 beside it with its Quote link. */
export const NoQuotePost: Story = {};
export const NoQuotePostPhone: Story = { parameters: { moment: '02-phone' } };
