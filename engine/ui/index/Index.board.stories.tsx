/**
 * The index, drawn as a story against board 01 of the board look design (`docs/research/2026-11-06-board-look/01-index.html`, 1440 by 1000):
 * the banner and the boards' bar as one block, the period table of boards, the Who is online box and the footer, with the HUD docked under
 * them. The world is the board's: three threads on General, the last post Mrs. Hooligan's on Oct 6, 2026, nothing yet on The System's board,
 * and the player's two masks online (e2e/boards/2026-11-06-board-look/01-index.ts compares it).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame } from '../frame/Frame.tsx';
import { LoadedIndex } from '../loaded.tsx';
import type { World } from '../story.tsx';

const OCT_6 = Date.UTC(2026, 9, 6, 12);

const world: World = (fake, instance) => {
  const [first, second] = instance.classes;
  const me = fake.seed.account('story-player', { seasoned: true });
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', (second ?? first)!.key, { at: OCT_6 - 5 * 86_400_000 });
  const spritey = fake.seed.character(me, 'Spritey', first!.key, { at: OCT_6 - 5 * 86_400_000 });
  const general = instance.boards.find((b) => !b.system)!.slug;
  fake.seed.thread(general, spritey, 'A thread', 'Hello.', { at: OCT_6 - 2 * 86_400_000 });
  fake.seed.thread(general, spritey, 'Another thread', 'Hello again.', { at: OCT_6 - 86_400_000 });
  fake.seed.thread(general, hooligan, 'The last thread', 'Hi.', { at: OCT_6 });
  fake.seed.settle({ at: OCT_6 - 86_400_000, wallet: { [me]: 240 } });
  fake.signInAs(me);
  /* Both masks are online, the HUD's first: a presence box lists the longest there first. */
  for (const mask of [hooligan, spritey]) void Promise.resolve().then(() => fake.here({ kind: 'index' }, mask)).catch(() => {});
};

/** An index whose latest thread has a long title and a long-named last poster (e2e/list-rows.spec.ts, docs/plans/2026-11-12-list-rows-design.md, section 2.1); compared with no manifest. */
const longTitleWorld: World = (fake, instance) => {
  const [first, second] = instance.classes;
  const me = fake.seed.account('story-player', { seasoned: true });
  const hooligan = fake.seed.character(me, 'Sir Reginald Featherstonehaugh-Wetherby the Third', (second ?? first)!.key, { at: OCT_6 - 5 * 86_400_000 });
  const general = instance.boards.find((b) => !b.system)!.slug;
  fake.seed.thread(general, hooligan, 'A thread whose title goes on and on, well past the width a last post leaves it, so that it has to wrap', 'Hi.', { at: OCT_6 });
  fake.seed.settle({ at: OCT_6 - 86_400_000, wallet: { [me]: 240 } });
  fake.signInAs(me);
};

function IndexBoardStory() {
  return <Frame><LoadedIndex /></Frame>;
}

const meta: Meta<typeof IndexBoardStory> = {
  title: 'Boards/01 Index',
  component: IndexBoardStory,
  parameters: { world, path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof IndexBoardStory>;

/** The index on the Main board's layout, at 1440 wide. */
export const Index: Story = {};

/** The index with a long title and a long name in the last post (a name wider than the row on a phone, which the unit holds: its "·" stays at the head of the name's first line and its comma hangs); compared with no manifest. */
export const LongTitle: Story = { parameters: { world: longTitleWorld } };
