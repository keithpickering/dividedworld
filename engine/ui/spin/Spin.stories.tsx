import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { ThreadSummary } from '../data/api.ts';
import type { World } from '../story.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { SpinForm } from './SpinForm.tsx';
import { LoadedThread } from '../loaded.tsx';

const TITLE = 'Where it began';

/** The thread with this title, once the world has it. */
function useThread(title: string): ThreadSummary | null {
  const { api } = useKayfa();
  const [found, setFound] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      /* The world's spin may still be under way when the story first reads: look again a few times. */
      for (let attempt = 0; attempt < 20 && live; attempt++) {
        for (const board of await api.boards()) {
          const hit = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === title);
          if (hit) { if (live) setFound(hit); return; }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    return () => { live = false; };
  }, [api, title]);
  return found;
}

/** The thread spun from the first post of "Where it began", opened on its ORIGIN box. */
function SpunThread() {
  const spun = useThread('Spun from the start');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The thread spun from a card play on the first post, opened on its ORIGIN box. */
function PlaySpunThread() {
  const spun = useThread('Spun from the play');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The thread spun from the mark of a card on a character, on a post by that character, opened on its ORIGIN box. */
function PressedSpunThread() {
  const spun = useThread('Spun at the shine');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The thread spun from the same card with no post pressed (as every such spin was made before), opened on its ORIGIN box. */
function LandedSpunThread() {
  const spun = useThread('Spun from the shine');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The first post's spin form, open under it. */
function OpenForm() {
  const first = useThread(TITLE);
  return first?.firstAct ? <SpinForm origin={first.firstAct} label="post 1" onClose={() => undefined} /> : <div aria-busy="true" />;
}

const meta: Meta = { title: 'Spin/Spin' };
export default meta;

const world: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  const t = fake.seed.thread(general, other, TITLE, 'A post worth a thread of its own.');
  fake.seed.post(t.thread, mine, 'An answer.');
  /* The fake does its work before it answers, so the spun thread is there when the story reads. */
  fake.signInAs(me);
  void fake.spin(t.act, mine, 'Spun from the start', 'Carrying on over here.');
  const play = fake.seed.card(other, t.act, instance.cards[0]!.key, { message: 'Oops.' });
  void fake.spin(play, mine, 'Spun from the play', 'About that card.');
};

/**
 * A card that reaches a character (the instance's own: the engine names none) cast from the first post of one thread, and two threads
 * spun from it: one pressed on a later post by that character, one with no post pressed. With no such card in the instance, nothing is spun.
 */
const reachWorld: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  const card = instance.cards.find((c) => c.reaches?.includes('character'));
  const cast = fake.seed.thread(general, other, 'Where the card was cast', 'The post the card was cast from.');
  const shiny = fake.seed.thread(general, mine, 'Why are my posts shiny', 'A post of mine.');
  const pressed = fake.seed.post(shiny.thread, other, 'The post it was pressed on.');
  fake.signInAs(me);
  if (!card) return;
  const play = fake.seed.reach(mine, 'character', other, card.key, { post: cast.act });
  void fake.spin(play, mine, 'Spun at the shine', 'About that post.', undefined, pressed);
  void fake.spin(play, mine, 'Spun from the shine', 'About that card.');
};

/** The small form under a post that starts a thread from it. */
export const SpinFormOpen: StoryObj = { render: () => <OpenForm />, parameters: { world } };

/** A spun thread, opening on its ORIGIN box: the Act it came from, live, with a link back. */
export const OriginBox: StoryObj = { render: () => <SpunThread />, parameters: { world } };

/** A thread spun from a card play on a post: its head names the card and the post it landed on, linked. */
export const OriginBoxFromPlay: StoryObj = { render: () => <PlaySpunThread />, parameters: { world } };

/** A thread spun from a card on a character, pressed on one of its posts: the post as it was spun, the card's effect still, and a head that links the post and the one the card was cast from. */
export const OriginBoxFromCharacterAtPost: StoryObj = { render: () => <PressedSpunThread />, parameters: { world: reachWorld } };

/** A thread spun from a card on a character with no post pressed: the cast-from post as it landed, on one line. */
export const OriginBoxFromCharacterLanded: StoryObj = { render: () => <LandedSpunThread />, parameters: { world: reachWorld } };
