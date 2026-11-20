/**
 * A poll on a post as the board draws it (docs/plans/2026-11-20-polls-plan.md, Task 5; the mockup is docs/research/2026-11-20-polls/01-placement.html, option A): the thread screen with one
 * post that carries a poll, on the board's own white page, signed in as the player whose HUD mask is Pipewrench. Each story is a state the poll can be in: open (a public poll, the mask not yet
 * voted), voted (the mask's ballot is counted and checked, with its change and withdraw), closed, secret (no names), choose three (checkboxes), the author's own (a Close poll), no mask (the
 * account has no character that can vote), and under a Whoops! ink (the ink paints under the poll, which stays readable and pressable). The cards are named by key (`cardOf`), never picked.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import type { Fake } from '../data/fake.ts';
import { useKayfa } from '../context.tsx';
import { LoadedThread } from '../loaded.tsx';
import { cardOf, type World } from '../story.tsx';
import type { Instance } from '../../rules/types.ts';

const TITLE = 'Ranking every Mario Kart';
const DAY = 86_400_000;
type Scene = 'spun' | 'open' | 'voted' | 'closed' | 'secret' | 'three' | 'own' | 'no-mask' | 'whoops';

/** The world's spin, done: a story's world is made before it renders, and the page is read after this. */
let seeded: Promise<unknown> = Promise.resolve();
const KARTS = ['Pipe Frame', 'Badwagon', 'Mr. Scooty'];
const COURSES = ['Rainbow Road', 'Mute City', 'Moo Moo Meadows', 'Baby Park', 'Toad Harbor'];

const worldOf = (scene: Scene): World => (fake: Fake, instance: Instance) => {
  const [first, second] = instance.classes;
  /* The fake's clock is brought to the page's, so a poll that lasts two days is open now. */
  fake.clock.advance(Date.now() - fake.clock.now());
  const me = fake.seed.account('story-player', { seasoned: true });
  const mine = fake.seed.character(me, 'Pipewrench', first!.key);
  const other = fake.seed.account('story-other', { seasoned: true });
  const spritey = fake.seed.character(other, 'Spritey', (second ?? first)!.key);
  const third = fake.seed.account('story-third', { seasoned: true });
  const wario = fake.seed.character(third, 'Wario', first!.key);
  const junior = fake.seed.character(third, 'Bowser Jr.', (second ?? first)!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const made = fake.seed.thread(board, scene === 'own' ? mine : spritey, TITLE, 'We have argued for three pages. Settle this.');
  const three = scene === 'three';
  const poll = fake.seed.poll(made.act, {
    question: three ? 'Which courses stay in the cup?' : 'Best kart in the series?',
    options: three ? COURSES : KARTS,
    pick: three ? 3 : 1,
    secret: scene === 'secret',
    lasts: { unit: 'day', count: 2 },
  });
  fake.seed.ballot(wario, poll, three ? [0, 2] : [0]);
  fake.seed.ballot(junior, poll, three ? [1] : [2]);
  if (scene === 'voted') fake.seed.ballot(mine, poll, [1]);
  if (scene === 'whoops') {
    const caster = fake.seed.character(fake.seed.account('story-caster'), 'Gloomba', first!.key);
    const whoops = cardOf(instance.cards, 'whoops');
    fake.seed.card(caster, made.act, whoops.key, { layer: 1, live: true, config: { ...(whoops.staffConfigs?.[0] ?? {}), seed: 2591 } as Readonly<Record<string, unknown>>, message: 'Settled.' });
  }
  if (scene === 'spun') seeded = fake.spin(poll, mine, 'Karts, settled', 'Carrying on over here.');
  if (scene === 'closed') fake.clock.advance(3 * DAY);
  fake.signInAs(scene === 'no-mask' ? fake.seed.account('story-nobody', { seasoned: true }) : me);
};

/** The thread, drawn by the thread screen, found by its title. */
function Seen({ scene }: { readonly scene?: Scene }) {
  const { api, instance } = useKayfa();
  const [thread, setThread] = useState<string | null | 'missing'>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await seeded;
      /* Every card met, so no one-line tip hangs off the ink's mark over the poll. */
      if (scene === 'whoops') for (const c of instance.cards) await api.meetCard(c.key);
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 200 })).threads.find((x) => x.title === TITLE);
        if (found) { if (live) setThread(found.id); return; }
      }
      if (live) setThread('missing');
    })();
    return () => { live = false; };
  }, [api, instance, scene]);
  if (thread === 'missing') return <p role="alert">The story's world has no thread titled for it.</p>;
  return thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />;
}

const meta: Meta<typeof Seen> = {
  title: 'Boards/28 Polls',
  component: Seen,
  parameters: { path: '/t/x', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Seen>;

/** A public poll, open, with two ballots counted and the mask not yet voted: the radios, the names under each option, and "Vote as Pipewrench" waiting for a pick. */
export const Open: Story = { parameters: { world: worldOf('open') } };
/** A thread was spun from the poll: its SpunInto stands in the foot. */
export const Spun: Story = { parameters: { world: worldOf('spun') } };
/** The mask has voted: its pick is checked, and the foot offers "Change ballot" and "Withdraw". */
export const Voted: Story = { parameters: { world: worldOf('voted') } };
/** A poll past its time: no inputs, "closed" in the head, and one plain line in the foot. */
export const Closed: Story = { parameters: { world: worldOf('closed') } };
/** Secret ballots: the counts, and nothing about who; no Ballots list. */
export const Secret: Story = { parameters: { world: worldOf('secret') } };
/** Choose three of five: checkboxes. */
export const ChooseThree: Story = { parameters: { world: worldOf('three') } };
/** The poll on the HUD mask's own post: "Close poll" stands in the foot. */
export const Own: Story = { parameters: { world: worldOf('own') } };
/** An account with no character that can vote: no inputs, and one plain line. */
export const NoMask: Story = { parameters: { world: worldOf('no-mask') } };
/** A Whoops! ink on the post: the ink fills the content area and paints under the poll, which stays readable and pressable. */
export const UnderWhoops: Story = { args: { scene: 'whoops' }, parameters: { world: worldOf('whoops') } };
