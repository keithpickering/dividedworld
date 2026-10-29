import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import type { Instance } from '../../rules/types.ts';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import type { World } from '../story.tsx';
import { ThreadScreen } from './Thread.tsx';

/** The screen for the thread of a story's world with this title: a story cannot know the id its world gives it. */
function ThreadTitled({ title }: { readonly title: string }) {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
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

const meta: Meta<typeof ThreadTitled> = { title: 'Thread/Thread', component: ThreadTitled };
export default meta;

type Story = StoryObj<typeof ThreadTitled>;

const T0 = Date.UTC(2026, 9, 20, 12);
const MIN = 60_000;

const cast = (fake: Fake, instance: Instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key, { at: T0 });
  const spritey = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key, { at: T0 });
  fake.seed.settle({ at: T0, standings: { [mine]: 650, [spritey]: 120 } });
  fake.signInAs(me);
  return { mine, spritey, general: instance.boards.find((b) => !b.system)!.slug, system: instance.boards.find((b) => b.system)!.slug };
};

const short: World = (fake, instance) => {
  const w = cast(fake, instance);
  fake.seed.avatar(w.spritey, { square: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' });
  const t = fake.seed.thread(w.general, w.spritey, 'Who keeps reacting with tea?', 'Every post I make, a single [b]tea[/b]. Show yourself.', { at: T0 + MIN });
  const reply = fake.seed.post(t.thread, w.mine, `[quote=${t.act}]a single tea[/quote]It was me. It is always me.\n\n[url=https://example.com]Proof[/url]`, { at: T0 + 2 * MIN });
  const fan = fake.seed.account('story-fan');
  fake.seed.react(fan, fake.seed.character(fan, 'Fan', instance.classes[0]!.key, { at: T0 }), reply, 'tea');
  fake.seed.reveal(w.mine, t.thread, { class: instance.classes[0]!.key, message: 'Told you.', at: T0 + 3 * MIN });
  fake.seed.post(t.thread, w.spritey, 'I knew it.', { at: T0 + 4 * MIN });
};

export const ShortThread: Story = { args: { title: 'Who keeps reacting with tea?' }, parameters: { world: short, path: '/t/x' } };

export const LongThreadPageThree: Story = {
  args: { title: 'The long one' },
  parameters: {
    world: ((fake, instance) => {
      const w = cast(fake, instance);
      const t = fake.seed.thread(w.general, w.spritey, 'The long one', 'Post 1.', { at: T0 });
      for (let i = 2; i <= 90; i++) fake.seed.post(t.thread, i % 2 ? w.spritey : w.mine, `Post ${i} of the long one.`, { at: T0 + i * MIN });
    }) satisfies World,
    path: '/t/x?page=3',
  },
};

export const StackedForTheReader: Story = {
  args: { title: 'Who keeps reacting with tea?' },
  parameters: { world: ((fake, instance) => { short(fake, instance); void fake.setPreferences({ postbit: 'stacked' }); }) satisfies World, path: '/t/x' },
};

export const TheSystemsTally: Story = {
  args: { title: 'The first tally' },
  parameters: {
    world: ((fake, instance) => {
      const w = cast(fake, instance);
      const t = fake.seed.thread(w.system, null, 'The first tally', 'The board turns tonight.', { at: T0 });
      fake.seed.post(t.thread, null, '', { payload: { debuts: [{ character: w.mine, name: 'Pipewrench' }, { character: w.spritey, name: 'Spritey', class: instance.classes[0]!.key }], turns: [{ character: w.mine, name: 'Pipewrench', loudness: 'announced', was: instance.classes[0]!.key }] }, at: T0 + MIN });
    }) satisfies World,
    path: '/t/x',
  },
};
