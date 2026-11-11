/**
 * The payout cards' screens (docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 9), on the boards fixture's player, whose HUD is on Pipewrench:
 * `Skim`, `Ride`, `RideBack` and `ScoredAs` (the Lens of each, with its status and its end) and `SkimForm`, `RideBackForm` and `ScoredAsForm` (the
 * play form of each, opened as a player opens it, on Pipewrench's own post #43). Each card is found by its rules, naming no card and no instance.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { playOf } from '../../rules/cards.ts';
import type { CardRules } from '../../rules/cards.ts';
import type { Fake } from '../data/fake.ts';
import { useKayfa } from '../context.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { usePlayer } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { usePlay } from './play.tsx';

type Scene = 'skim' | 'ride' | 'rideBack' | 'scoredAs' | 'skimForm' | 'rideBackForm' | 'scoredAsForm';

/** The card each scene is about, by what its rules say it does. */
const found = (cards: readonly CardRules[], scene: Scene): CardRules | undefined => {
  switch (scene) {
    case 'skim': case 'skimForm': return cards.find((c) => c.skim !== undefined);
    case 'ride': return cards.find((c) => c.gimmick?.kind === 'ride');
    case 'rideBack': case 'rideBackForm': return cards.find((c) => playOf(c) === 'set' && c.trap?.outcome !== undefined);
    case 'scoredAs': case 'scoredAsForm': return cards.find((c) => c.scoresAs === true);
  }
};

/** Seeds the scene on a thread Pipewrench started, and answers the thread to show (the forms use the fixture's own). */
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
      for (const c of instance.cards) await api.meetCard(c.key);
      if (scene.endsWith('Form')) { if (live) setShown(thread); return; }
      const fake = api as Fake;
      const pipe = (await api.myCharacters()).find((c) => c.name === 'Pipewrench');
      const card = found(instance.cards, scene);
      if (!pipe || !card) throw new Error('the boards fixture has no Pipewrench, or the instance has no such card');
      const { thread: mine, act: post } = fake.seed.thread('general', pipe.id, 'A thread Pipewrench started', 'The opening post.');
      const ends = new Date(Date.now() + 5 * 86_400_000).toISOString();
      if (scene === 'skim') fake.seed.card(pipe.id, post, card.key, { config: { quadrant: 'excitedPositive' }, ends });
      else if (scene === 'ride') fake.seed.card(pipe.id, post, card.key, { ends });
      else if (scene === 'rideBack') fake.seed.set(pipe.id, post, card.key, { at: Date.now() });
      else fake.seed.reach(pipe.id, 'character', pipe.id, card.key, { post, config: { class: 'heel' }, ends: Date.now() + 2 * 86_400_000 });
      if (live) setShown(mine);
    })().catch((e: unknown) => { console.error('the story could not be seeded', String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);
  return shown;
}

/** Does what a player does: presses the card's mark to open its Lens, or arms the card and presses the ghost on #43 to open its play form. */
function Act({ scene }: { readonly scene: Scene }) {
  const { instance } = useKayfa();
  const play = usePlay();
  const account = usePlayer().session.account;
  useEffect(() => {
    if (!play || account === null) return;
    const form = scene.endsWith('Form');
    const key = found(instance.cards, scene)?.key;
    if (form && key) play.arm(key);
    const timer = setInterval(() => {
      if (form) {
        const ghost = document.querySelector<HTMLButtonElement>('#post-43 .kb-ghost-mark');
        if (ghost) { clearInterval(timer); ghost.click(); }
        return;
      }
      const mark = document.querySelector<HTMLButtonElement>(`.kb-mark[data-kb-card="${key ?? ''}"], .kb-mark[data-kb-back="down"]`);
      if (mark) { clearInterval(timer); mark.scrollIntoView?.({ block: 'center' }); mark.click(); }
    }, 150);
    return () => clearInterval(timer);
    // Once for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);
  return null;
}

function Story({ scene }: { readonly scene: Scene }) {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const shown = useSeeded(scene, thread);
  return (
    <Frame>
      <Act scene={scene} />
      {shown ? <LoadedThread thread={shown} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Story> = { title: 'Boards/01 Payout cards', component: Story, parameters: { moment: '01-main', layout: 'fullscreen' } };
export default meta;
type S = StoryObj<typeof Story>;

/** A skim play on a post: the Lens says which reactions it names, and when it ends. */
export const Skim: S = { args: { scene: 'skim' } };
/** A ride Gimmick used on a post: the Lens says it pays the post's author, and when it ends. */
export const Ride: S = { args: { scene: 'ride' } };
/** A ride Reversal set face down on the reader's own post: the Lens of the card back, which is the same for every card. */
export const RideBack: S = { args: { scene: 'rideBack' } };
/** A scored-as play on the reader's own character: the Lens says the class it names and when the window comes. */
export const ScoredAs: S = { args: { scene: 'scoredAs' } };
/** The skim card's play form: the four reactions, nothing chosen until the player chooses. */
export const SkimForm: S = { args: { scene: 'skimForm' } };
/** The ride Reversal's play form: the faces of the Moves it can wait for, then the four reactions. */
export const RideBackForm: S = { args: { scene: 'rideBackForm' } };
/** The scored-as card's play form: the instance's classes, nothing chosen until the player chooses. */
export const ScoredAsForm: S = { args: { scene: 'scoredAsForm' } };
