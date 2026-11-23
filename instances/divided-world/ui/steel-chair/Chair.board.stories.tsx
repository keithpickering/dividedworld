/**
 * Steel Chair as stories for the owner's word (docs/plans/2026-11-15-steel-chair-plan.md, Task 7): a post of a thread with one chair thrown at it
 * (`OneLight`, `OneDark`), three chairs from three characters (`Three`), a post of one line of words (`ShortPost`, the worst case for the room under
 * the words), the same one line with three chairs from three characters (`ShortThree`, where the dents must leave the line readable) and the
 * one chair with motion reduced (`Reduced`, `data-kb-motion="reduce"`, where the chair is at rest and the dent drawn at once), and Steel Chair with Feelin' Fab on the same three paragraphs (`WithFab`, where the shading lies over a foil, issue #768), and the same two played the other way round (`FabAfter`).
 * Each throw is drawn on the reader's own screen when the post's middle has been in view for 300 ms, and differs every time; e2e/steel-chair.spec.ts
 * waits for it to rest. Open them at 1440 by 1120.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import { cardOf, type World } from '../../../../engine/ui/story.tsx';

/** The thread the world seeded: a story's world is made before it renders. */
let thread = '';

const WORDS = [
  'The best driver in the entire series is Luigi. I will not be taking questions. He has the death stare, he has the moustache, and he has the quiet confidence of a man who knows he is better than his brother.',
  'Some people will tell you Luigi is a meme. Those people have never lost a race to him on Rainbow Road at two in the morning, with a blue shell on the way and nobody left to blame.',
  'Anyway, Double Dash is still the greatest game ever made, and I would die on that hill. That is all. Thank you for coming to my talk.',
].join('\n\n');

/** A thread with a post by a character, and `throwers` characters (one to three) who each play Steel Chair on it. */
const worldOf = (words: string, throwers: number, fab: false | 'chair-first' | 'fab-first' = false): World => (fake, instance) => {
  const rules = cardOf(instance.cards, 'steel-chair');
  const [first, second] = instance.classes;
  const player = fake.seed.account('story-player', { seasoned: true });
  const board = instance.boards.find((b) => !b.system)!.slug;
  const kooperAccount = fake.seed.account('kooper');
  const kooper = fake.seed.character(kooperAccount, 'Kooper Trooper', first!.key);
  const made = fake.seed.thread(board, kooper, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best. Number one is Double Dash.');
  const post = fake.seed.post(made.thread, kooper, words);
  const names = ['Spritey', 'Gloomba', 'Bob-omb Bill'];
  /* Feelin' Fab on the same post: its foil fills the content area as the chair's shading does (issue #768). The later play is the outer effect
     (`nestOrder`), so `fab-first` is a chair played over a foil, and `chair-first` a foil over a chair. */
  const fabAt = () => fake.seed.card(fake.seed.character(fake.seed.account('fab-caster'), 'Glimmer', (second ?? first)!.key), post, cardOf(instance.cards, 'feelin-fab').key, { layer: 1, live: true, config: {}, message: 'Fab' });
  if (fab === 'fab-first') fabAt();
  for (let i = 0; i < throwers; i++) {
    const account = i === 0 ? player : fake.seed.account(`thrower-${i}`);
    const who = fake.seed.character(account, names[i]!, (i % 2 === 0 ? first : (second ?? first))!.key);
    fake.seed.card(who, post, rules.key, { layer: 1, live: true, config: {}, message: 'Steel Chair' });
  }
  if (fab === 'chair-first') fabAt();
  /* The signature lies under the reactions, in the content area, over a foil that bleeds under everything (e2e/steel-chair.spec.ts). */
  if (fab) { fake.signInAs(kooperAccount); void fake.setProfile(kooper, '', 'Luigi forever. Do not @ me.', instance.pipStyles[0]?.key ?? 'default'); }
  fake.signInAs(player);
  thread = made.thread;
};

interface Args { readonly mode: 'light' | 'dark'; readonly reduced?: boolean }

function Chaired({ mode, reduced = false }: Args) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    if (reduced) root.setAttribute('data-kb-motion', 'reduce');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [mode, reduced]);
  return <Frame><LoadedThread thread={thread} /></Frame>;
}

const meta: Meta<typeof Chaired> = {
  title: 'Boards/25 Steel Chair',
  component: Chaired,
  parameters: { world: worldOf(WORDS, 1), layout: 'fullscreen' },
  args: { mode: 'light' },
};
export default meta;

type Story = StoryObj<typeof Chaired>;

export const OneLight: Story = { args: { mode: 'light' } };
export const OneDark: Story = { args: { mode: 'dark' } };
export const Three: Story = { args: { mode: 'light' }, parameters: { world: worldOf(WORDS, 3) } };
export const ShortPost: Story = { args: { mode: 'light' }, parameters: { world: worldOf('Luigi wins.', 1) } };
/** One line of words, three plays by three characters: the hard case for the dents, which must leave the line readable (e2e/steel-chair.spec.ts). */
export const ShortThree: Story = { args: { mode: 'light' }, parameters: { world: worldOf('Luigi wins.', 3) } };
export const Reduced: Story = { args: { mode: 'light', reduced: true } };
/** The three-paragraph post with Steel Chair and Feelin' Fab both on it: the shading is an image with its own alpha and takes nothing from what is behind it (issue #768). */
export const WithFab: Story = { args: { mode: 'light' }, parameters: { world: worldOf(WORDS, 1, 'fab-first') } };
/** The same post with the order turned: Steel Chair played first, then Feelin' Fab (Fab is the outer effect, and the chair's dents are under its foil). */
export const FabAfter: Story = { args: { mode: 'light' }, parameters: { world: worldOf(WORDS, 1, 'chair-first') } };
