/**
 * The card types' screens (docs/plans/2026-11-11-card-types-design.md, sections 5 and 6), on the boards fixture's player, whose HUD is on Pipewrench:
 * `Ghost` (a Gimmick armed, its ghost on the head of a thread Pipewrench started), `TakeBack` (the Lens of Pipewrench's own back, with its Take back
 * control) and `Surcharge` (a Move's play form on that thread, where a Gimmick adds to the price). Each is found by its rules, naming no card.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { playOf } from '../../rules/cards.ts';
import type { Fake } from '../data/fake.ts';
import { useKayfa } from '../context.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { usePlayer } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { usePlay } from './play.tsx';

type Scene = 'ghost' | 'takeback' | 'surcharge';

/** Seeds the scene, and answers the thread to show. */
function useSeeded(scene: Scene, thread: string | null): string | null {
  const { api, instance } = useKayfa();
  const [shown, setShown] = useState<string | null>(null);
  /* Seeded once: the fake keeps what is seeded, and a second seeding would lay a second thread. */
  const done = useRef(false);
  useEffect(() => {
    if (thread === null || done.current) return;
    done.current = true;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      for (const c of instance.cards) await api.meetCard(c.key);
      const pipe = (await api.myCharacters()).find((c) => c.name === 'Pipewrench');
      if (!pipe) throw new Error('the boards fixture has no Pipewrench');
      if (scene === 'takeback') {
        const acts = await api.acts(thread, 43, 43);
        const own = acts.find((a) => a.seq === 43);
        const back = instance.cards.find((c) => playOf(c) === 'set' && c.trap?.trigger.on === 'cast');
        if (!own || !back) throw new Error('no #43 or no Set card');
        fake.seed.set(pipe.id, own.id, back.key, { at: Date.now() });
        if (live) setShown(thread);
        return;
      }
      const mine = fake.seed.thread('general', pipe.id, 'A thread Pipewrench started', 'The opening post.').thread;
      const price = instance.cards.find((c) => c.gimmick?.kind === 'price');
      if (scene === 'surcharge' && price) fake.seed.reach(pipe.id, 'thread', mine, price.key, { ends: Date.now() + 86_400_000 });
      if (live) setShown(mine);
    })().catch((e: unknown) => { console.error('the story could not be seeded', String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);
  return shown;
}

/** Does what a player does: arms the card, then presses the ghost, the mark and Who. */
function Act({ scene }: { readonly scene: Scene }) {
  const { instance } = useKayfa();
  const play = usePlay();
  const account = usePlayer().session.account;
  useEffect(() => {
    if (!play || account === null) return;
    const key = scene === 'ghost' ? instance.cards.find((c) => c.gimmick?.kind === 'price')?.key
      : scene === 'surcharge' ? instance.cards.find((c) => playOf(c) === 'cast' && c.alignment === 'salty')?.key : undefined;
    if (key) play.arm(key);
    const timer = setInterval(() => {
      if (scene === 'surcharge') { const g = document.querySelector<HTMLButtonElement>('#post-1 .kb-ghost-mark'); if (g) { clearInterval(timer); g.click(); } }
      if (scene === 'takeback') {
        const mark = document.querySelector<HTMLButtonElement>('#post-43 .kb-mark[data-kb-back="down"]');
        if (mark) { clearInterval(timer); mark.scrollIntoView({ block: 'center' }); mark.click(); setTimeout(() => document.querySelector<HTMLButtonElement>('.kb-lens .kb-lens-fold')?.click(), 400); }
      }
    }, 150);
    return () => clearInterval(timer);
    // Once for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);
  return null;
}

function Story({ scene }: { readonly scene: Scene }) {
  const path = useLocation().path;
  const thread = /^\/t\/([^/]+)/u.exec(path)?.[1] ?? null;
  const shown = useSeeded(scene, thread);
  return (
    <Frame>
      <Act scene={scene} />
      {shown ? <LoadedThread thread={shown} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Story> = { title: 'Cards/Card types', component: Story, parameters: { moment: '01-main', layout: 'fullscreen' } };
export default meta;
type S = StoryObj<typeof Story>;

/** A Gimmick armed: its ghost on the head of a thread the reader's character started. */
export const Ghost: S = { args: { scene: 'ghost' } };
/** The Lens of the reader's own card back, with Take back and what it does. */
export const TakeBack: S = { args: { scene: 'takeback' } };
/** A Move's play form, with the Gimmick that adds to its price said by name. */
export const Surcharge: S = { args: { scene: 'surcharge' } };
