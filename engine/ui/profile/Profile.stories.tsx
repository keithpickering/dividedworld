import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { World } from '../story.tsx';
import { ProfileScreen } from './Profile.tsx';
import { RecordScreen } from './Record.tsx';

const meta: Meta<typeof ProfileScreen> = { title: 'Profile/Profile', component: ProfileScreen };
export default meta;

type Story = StoryObj<typeof ProfileScreen>;

const T0 = Date.UTC(2026, 9, 1, 12);

/** Spritey has posted, played a card and revealed its class; Pipewrench is the visitor. */
const full: World = (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const me = fake.seed.account('story-player');
  const spritey = fake.seed.character(fake.seed.account('story-other'), 'Spritey', cls, { at: T0 });
  fake.seed.character(me, 'Pipewrench', cls, { at: T0 });
  const general = instance.boards.find((b) => !b.system)!.slug;
  const { thread, act } = fake.seed.thread(general, spritey, 'A thread', 'Hello.', { at: T0 + 86_400_000 });
  for (let i = 0; i < 25; i++) fake.seed.post(thread, spritey, `Post ${i + 2}`, { at: T0 + 2 * 86_400_000 + i * 60_000 });
  fake.seed.card(spritey, act, instance.cards[0]!.key, { at: T0 + 3 * 86_400_000 });
  fake.seed.reveal(spritey, thread, { class: cls, at: T0 + 4 * 86_400_000 });
  fake.seed.settle({ standings: { [spritey]: 350 } });
  fake.signInAs(me);
};

/** The top of the standings, whatever id the story's world gave it. */
function Top({ record }: { readonly record?: boolean }) {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { void api.standings().then((r) => setId(r[0]?.character ?? 'nobody')); }, [api]);
  if (id === null) return null;
  return record ? <RecordScreen id={id} /> : <ProfileScreen id={id} />;
}

export const Full: Story = { render: () => <Top />, parameters: { world: full, path: '/' } };
export const NotFound: Story = { render: () => <ProfileScreen id="nobody" />, parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('story-player')); }) satisfies World, path: '/c/nobody' } };
export const Record: Story = { render: () => <Top record />, parameters: { world: full, path: '/' } };
