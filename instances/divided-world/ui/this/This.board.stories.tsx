/**
 * THIS as stories for the owner's word (docs/plans/2026-11-13-this-plan.md, Task 9): the mocks' post (docs/research/2026-11-12-this/02-desk.html) in a thread, on the Main
 * board and at 390 wide, the Phone one. `TwoNotes` is the mocks' two notes on one post, one agreeing and one not; `Bare` is a THIS with no words; `Receipt` is a note beside a
 * receipt (the second phrase was edited out of the post after it was played on); `Taped` is a note on a phrase Autocorrect's tape covers; `Inked` is a note on a post with
 * Whoops!'s ink over it; `Fab` is a note on a post under Feelin' Fab's bright ink. The story route renders no play function, so e2e/this.spec.ts measures them itself.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import type { World } from '../../../../engine/ui/story.tsx';

type Case = 'two' | 'bare' | 'receipt' | 'taped' | 'inked' | 'fab';

/** The thread each case's world seeded: a story's world is made before it renders. */
const threads: Partial<Record<Case, string>> = {};

const BODY = [
  'Okay, hot take time. The physics in the original engine were never the problem. People blame the engine because it\'s easier than admitting their levels were bad.',
  'I played forty of the contest entries last weekend. The ones that felt good all used the default settings. Every single one.',
  'Anyway the new level editor is fine. Stop asking for slopes. That is all I have to say about it, and I will not be taking questions from the back.',
].join('\n\n');
const EDITED = BODY.replace('Stop asking for slopes. ', '');

const FIRST = 'People blame the engine because it\'s easier than admitting their levels were bad.';
const SECOND = 'Stop asking for slopes.';

const worldOf = (shown: Case): World => (fake, instance) => {
  const [first, second] = instance.classes;
  const player = fake.seed.account('story-player', { seasoned: true });
  const spritey = fake.seed.character(player, 'Spritey', first!.key);
  const gloomba = fake.seed.character(fake.seed.account('gloomba'), 'Gloomba', (second ?? first)!.key);
  const kooper = fake.seed.character(fake.seed.account('kooper'), 'Kooper Trooper', first!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const made = fake.seed.thread(board, kooper, 'The engine was never the problem', 'Okay, hot take time.');
  const post = fake.seed.post(made.thread, spritey, BODY);
  const note = (by: string, layer: number, phrase: string, words: string) => fake.seed.card(by, post, 'this', { layer, live: true, config: { phrase, words }, message: 'THIS' });
  if (shown === 'bare') note(gloomba, 1, FIRST, '');
  else if (shown === 'receipt') { note(gloomba, 1, FIRST, 'finally somebody said it'); note(kooper, 2, SECOND, 'is how you lose the whole board'); fake.seed.edit(post, spritey, EDITED); }
  else if (shown === 'taped') {
    fake.seed.card(kooper, post, 'autocorrect', { layer: 1, live: true, config: { phrase: FIRST, replacement: 'Luigi was robbed' }, message: '' });
    note(gloomba, 2, FIRST, 'finally somebody said it');
  } else {
    note(gloomba, 1, FIRST, 'finally somebody said it');
    if (shown === 'two') note(kooper, 2, SECOND, 'is how you lose the whole board');
    if (shown === 'inked') fake.seed.card(kooper, post, 'whoops', { layer: 3, config: { color: '#19e3ff', seed: 202 }, message: 'cyan, obviously' });
    if (shown === 'fab') fake.seed.card(gloomba, post, 'feelin-fab', { layer: 3, live: true, config: {}, message: 'Fab' });
  }
  fake.signInAs(player);
  threads[shown] = made.thread;
};

function Thread({ shown }: { readonly shown: Case }) {
  return <Frame><LoadedThread thread={threads[shown]!} /></Frame>;
}

const meta: Meta<typeof Thread> = {
  title: 'Boards/23 THIS',
  component: Thread,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Thread>;
const phone = { viewport: { value: 'glassPhone390', isRotated: false } };
const of = (shown: Case): Story => ({ args: { shown }, parameters: { world: worldOf(shown) } });
const onPhone = (shown: Case): Story => ({ ...of(shown), globals: phone });

/** The mocks' post: two notes, one agreeing and one not. */
export const TwoNotesMain: Story = of('two');
export const TwoNotesPhone: Story = onPhone('two');
/** A THIS with no words. */
export const BareMain: Story = of('bare');
export const BarePhone: Story = onPhone('bare');
/** A note beside a receipt: the second phrase was edited out. */
export const ReceiptMain: Story = of('receipt');
export const ReceiptPhone: Story = onPhone('receipt');
/** A note on a phrase Autocorrect's tape covers. */
export const TapedMain: Story = of('taped');
export const TapedPhone: Story = onPhone('taped');
/** A note on a post with Whoops!'s ink over it. */
export const InkedMain: Story = of('inked');
export const InkedPhone: Story = onPhone('inked');
/** A note on a post under Feelin' Fab. */
export const FabMain: Story = of('fab');
export const FabPhone: Story = onPhone('fab');
