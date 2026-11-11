/**
 * The card mechanic's marks, as stories for the owner's word (docs/plans/2026-11-01-card-plays-plan.md, Task 9): post #41 of the
 * boards fixture, read at the Main board's moment, carrying a card set face down by its author (`Back`, the same for every card);
 * the same back after a trap on it caught a cast (`Caught`: the back shows the card that sprang in its place, and the caught play's
 * mark is dimmed); a ward used on it (`Ward`); and a Set card armed (`ArmedSet`: its ghost mark only on the reader's own posts). Each
 * has its `Phone` twin at 390 by 844; open the others at 1440 by 1120.
 *
 * The story names no instance: the cards are the instance's first Set card, first ward and first Cast, found by their rules.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { useLocation } from '../router.tsx';
import { usePlayer } from '../player.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { playOf } from '../../rules/cards.ts';
import { usePlay } from './play.tsx';
import { LoadedThread } from '../loaded.tsx';

type Scene = 'back' | 'caught' | 'ward' | 'armed';

/** Lay #41's scene, then say the thread is ready to be read. */
function useSeeded(thread: string | null, scene: Scene): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
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
      const setCard = instance.cards.find((c) => playOf(c) === 'set' && c.trap?.trigger.on === 'cast');
      const ward = instance.cards.find((c) => c.ward);
      const cast = instance.cards.find((c) => playOf(c) === 'cast');
      if (scene === 'back' || scene === 'caught') {
        if (!setCard) throw new Error('the instance has no Set card with a cast trap');
        const set = fake.seed.set(target.character, target.id, setCard.key);
        if (scene === 'caught' && cast) {
          const caught = fake.seed.card(caster, target.id, cast.key, { message: '', caught: set });
          fake.seed.spring(set, { caught });
        }
      }
      if (scene === 'ward' && ward) {
        fake.seed.card(target.character, target.id, ward.key, { message: '', layer: 1, ends: new Date(Date.now() + 5 * 86_400_000).toISOString() });
      }
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the backs story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, scene]);
  return ready;
}

/** Arms the instance's first Set card, as the player's press in the hand does. */
function ArmSet() {
  const { instance } = useKayfa();
  const play = usePlay();
  const account = usePlayer().session.account;
  const key = instance.cards.find((c) => playOf(c) === 'set')?.key ?? null;
  useEffect(() => {
    if (!play || key === null || account === null) return;
    play.arm(key);
    // Armed once for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, account]);
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
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, scene);
  return (
    <Frame>
      {scene === 'armed' && <ArmSet />}
      <Look />
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Scene> = {
  title: 'Boards/01 Card backs',
  component: Scene,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Scene>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** #41 carries a card set face down by its author: one back, the same for any card. */
export const Back: Story = { args: { scene: 'back' } };
/** The back after its trap caught #42's author's cast: the card that sprang in its place, the caught play dimmed. */
export const Caught: Story = { args: { scene: 'caught' } };
/** A ward its author used on #41, for five more days. */
export const Ward: Story = { args: { scene: 'ward' } };
/** A Set card armed: its ghost mark ends the strip of the reader's own posts alone. */
export const ArmedSet: Story = { args: { scene: 'armed' } };
export const BackPhone: Story = { args: { scene: 'back' }, ...phone };
export const CaughtPhone: Story = { args: { scene: 'caught' }, ...phone };
export const WardPhone: Story = { args: { scene: 'ward' }, ...phone };
export const ArmedSetPhone: Story = { args: { scene: 'armed' }, ...phone };
