import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import type { World } from '../story.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { userEvent, within } from 'storybook/test';

function ThreadTitled({ title }: { readonly title: string }) {
  const { api } = useKayfa();
  const [id, setId] = useState<Id | null>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 200 })).threads.find((t) => t.title === title);
        if (found) { setId(found.id); return; }
      }
    })();
  }, [api, title]);
  return id ? <ThreadScreen thread={id} /> : <div aria-busy="true" />;
}

const meta: Meta<typeof ThreadTitled> = { title: 'Reactions/Reactions', component: ThreadTitled, args: { title: 'Hot take' } };
export default meta;
type Story = StoryObj<typeof ThreadTitled>;

const cast = (fake: Parameters<World>[0], instance: Parameters<World>[1]) => {
  const me = fake.seed.account('story-player');
  const [a, b] = instance.classes;
  const pipe = fake.seed.character(me, 'Pipewrench', a!.key);
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key);
  const other = fake.seed.account('story-other');
  const spritey = fake.seed.character(other, 'Spritey', a!.key);
  const fans = [1, 2, 3].map((n) => { const f = fake.seed.account(`fan${n}`); return { f, c: fake.seed.character(f, `Fan ${n}`, a!.key) }; });
  fake.signInAs(me);
  return { me, pipe, hooligan, spritey, fans, kinds: instance.reactions.map((r) => r.key) };
};

const hot: World = (fake, instance) => {
  const w = cast(fake, instance);
  const t = fake.seed.thread(instance.boards.find((b) => !b.system)!.slug, w.spritey, 'Hot take', 'The Situation Room should be the Sitcom Room.');
  w.fans.forEach((x, i) => fake.seed.react(x.f, x.c, t.act, w.kinds[i]!));
  fake.seed.react(w.me, w.pipe, t.act, w.kinds[3]!);
};

/** The picker open on a desktop, with one of three reactions already left. */
export const PickerOpen: Story = {
  parameters: { world: hot },
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'React' })); },
};

/** All three reactions left: the picker offers nothing more and says so. */
export const NoneLeft: Story = {
  parameters: {
    world: ((fake, instance) => {
      const w = cast(fake, instance);
      const t = fake.seed.thread(instance.boards.find((b) => !b.system)!.slug, w.spritey, 'Hot take', 'The Situation Room should be the Sitcom Room.');
      w.kinds.slice(0, 3).forEach((k, i) => fake.seed.react(w.me, i % 2 ? w.pipe : w.hooligan, t.act, k));
    }) satisfies World,
  },
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'React' })); },
};

/** A post by one of the player's own characters: its chips, and no React button. */
export const OwnPost: Story = {
  args: { title: 'My take' },
  parameters: {
    world: ((fake, instance) => {
      const w = cast(fake, instance);
      const t = fake.seed.thread(instance.boards.find((b) => !b.system)!.slug, w.pipe, 'My take', 'Nobody asked, and here it is.');
      w.fans.forEach((x, i) => fake.seed.react(x.f, x.c, t.act, w.kinds[i * 4]!));
    }) satisfies World,
  },
};
