/**
 * The Promos thread (the season-end design, sections 4 and 5), drawn as a story for the owner: the season's thread on The System's board, where
 * each character's announce Act reads as a line in the characters' own words, with the reactions every Act can take. The six lines are the
 * design's table: a debut that names no class, a debut as a class, a Turn from one class to another, a Turn leaving a class, a Turn to a class,
 * and a Turn that names neither. The classes are the instance's, by their place in its list. The page is the thread screen itself, as the route
 * /t/:thread draws it, signed in as the player. Held by e2e/boards/14-promos.ts.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { LoadedThread } from '../loaded.tsx';
import type { World } from '../story.tsx';

const TITLE = 'Season 2: Promos';
const T0 = Date.UTC(2026, 10, 2, 8, 17);
const MIN = 60_000;

/** The thread of this title on The System's board: a story cannot know the id its world gives it. */
function PromosThread() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 200 })).threads.find((t) => t.title === TITLE);
        if (found) { setId(found.id); return; }
      }
    })();
  }, [api]);
  return id ? <LoadedThread thread={id} /> : <div aria-busy="true" />;
}

const promos: World = (fake, instance) => {
  const cls = (i: number) => (instance.classes[i] ?? instance.classes[0]!).key;
  const { seed } = fake;
  const player = seed.account('player');
  const kind = (i: number) => (instance.reactions[i] ?? instance.reactions[0]!).key;
  const names = ['Thwompson', 'Gloomba', 'Pipewrench', 'Mrs. Hooligan', 'Spritey', 'Ringside 1'] as const;
  const owners = [player, seed.account('rival'), player, player, seed.account('reader'), seed.account('ringside')];
  const made = names.map((name, i) => seed.character(owners[i]!, name, cls(i % 4), { at: T0 - 60 * MIN }));
  seed.season({ number: 2, startsAt: new Date(T0 - 60 * MIN).toISOString() });
  seed.settle({ at: T0 - 30 * MIN, standings: { [made[0]!]: 100 } });
  const acts = [
    seed.announce(made[0]!, 'debut', { at: T0 }),
    seed.announce(made[1]!, 'debut', { at: T0 + MIN, class: cls(1) }),
    seed.announce(made[2]!, 'turn', { at: T0 + 2 * MIN, was: cls(0), class: cls(2) }),
    seed.announce(made[3]!, 'turn', { at: T0 + 3 * MIN, was: cls(0) }),
    seed.announce(made[4]!, 'turn', { at: T0 + 4 * MIN, class: cls(3) }),
    seed.announce(made[5]!, 'turn', { at: T0 + 5 * MIN }),
  ];
  seed.tally(acts[0]!, { [kind(0)]: 4, [kind(1)]: 2 });
  seed.tally(acts[1]!, { [kind(1)]: 7, [kind(9)]: 1 });
  seed.tally(acts[2]!, { [kind(0)]: 3, [kind(5)]: 2 });
  seed.tally(acts[4]!, { [kind(2)]: 5 });
  fake.signInAs(player);
};

const meta: Meta<typeof PromosThread> = {
  title: 'Boards/14 Promos',
  component: PromosThread,
  parameters: { world: promos, path: '/t/x', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof PromosThread>;

/** The six lines, with reactions, on the Main board's layout, at 1440 wide. */
export const Promos: Story = {};
/** The same thread on the Phone board's layout, at 390 by 844. */
export const PromosPhone: Story = {
  name: 'Promos, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
