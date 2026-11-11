import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { World } from '../story.tsx';
import { ProfileScreen } from './Profile.tsx';
import { RecordScreen } from './Record.tsx';
import { LoadedProfile, LoadedRecord } from '../loaded.tsx';
import { Avatar } from './Avatar.tsx';
import type { Character } from '../data/api.ts';
import type { Piece } from '../../rules/cosmetics.ts';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

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
  useEffect(() => { void api.standingsPage(0, 1).then((r) => setId(r[0]?.character ?? 'nobody')); }, [api]);
  if (id === null) return null;
  return record ? <LoadedRecord id={id} /> : <LoadedProfile id={id} />;
}

export const Full: Story = { render: () => <Top />, parameters: { world: full, path: '/' } };
export const NotFound: Story = { render: () => <LoadedProfile id="nobody" />, parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('story-player')); }) satisfies World, path: '/c/nobody' } };
export const Record: Story = { render: () => <Top record />, parameters: { world: full, path: '/' } };

/* A mask wearing gear on the profile's tall avatar: the first pieces the instance's own gear table offers, one reaching above the slot. */
function WearingAvatar() {
  const { ui } = useKayfa();
  const spots = [{ x: 0.5, y: 0, w: 0.7, turn: -8 }, { x: 0.5, y: 0.3, w: 0.5, turn: 0 }, { x: 0.7, y: 0.62, w: 0.3, turn: 14 }];
  const outfit: Piece[] = Object.keys(ui.gear).slice(0, 3).map((gear, i) => ({ gear, layer: i, ...spots[i]! }));
  const picture = (w: number, h: number) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/><circle cx="${w / 2}" cy="${h / 4}" r="${w / 4}"/></svg>`;
  const character: Character = {
    id: 'story-character', name: 'Pipewrench', title: '', signature: '', avatarSquare: picture(100, 100), avatarPortrait: picture(100, 140),
    squareFrame: { x: 0, y: 0, w: 1, h: 1 / 1.4 }, portraitFrame: null, portraitTallness: 1.4, outfit, trophies: [], pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'members',
  };
  return <div style={{ padding: '3em 3em 1em' }}><Avatar character={character} /></div>;
}
export const WearingGear: Story = { render: () => <WearingAvatar />, parameters: { world: () => {} } };
