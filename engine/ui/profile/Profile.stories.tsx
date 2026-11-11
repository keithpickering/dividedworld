import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { World } from '../story.tsx';
import { ProfileScreen } from './Profile.tsx';
import { RecordScreen } from './Record.tsx';
import { LoadedProfile, LoadedRecord } from '../loaded.tsx';

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

/* A mask wearing gear on the profile's tall avatar: the first pieces the instance's own gear table offers, one reaching above the slot, on the profile screen that names them in its Wearing row. */
const wearingWorld: World = (fake, instance) => {
  const owner = fake.seed.account('story-owner');
  const mask = fake.seed.character(owner, 'Pipewrench', instance.classes[0]!.key, { at: T0 });
  const picture = (w: number, h: number) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/><circle cx="${w / 2}" cy="${h / 4}" r="${w / 4}"/></svg>`;
  fake.seed.avatar(mask, { square: picture(100, 100), portrait: picture(100, 140) });
  const gear = instance.gear.slice(0, 3);
  fake.seed.gear(owner, Object.fromEntries(gear.map((g) => [g.key, 1])));
  fake.signInAs(owner);
  const spots = [{ x: 0.5, y: 0, w: 0.7, turn: -8 }, { x: 0.5, y: 0.3, w: 0.5, turn: 0 }, { x: 0.7, y: 0.62, w: 0.3, turn: 14 }];
  void fake.setOutfit(mask, gear.map((g, i) => ({ gear: g.key, layer: i, ...spots[i]! })));
};
function Mine({ name }: { readonly name: string }) {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { void api.myCharacters().then((mine) => setId(mine.find((c) => c.name === name)?.id ?? 'nobody')); }, [api, name]);
  return id === null ? null : <LoadedProfile id={id} />;
}
export const WearingGear: Story = { render: () => <Mine name="Pipewrench" />, parameters: { world: wearingWorld, path: '/' } };

/** Spritey in its trophy case (the cosmetics design, section 4): the instance's first trophy kinds given by the season and an admin, a belt (its own kind, else the first) passed from one holder to the next, and a portrait wearing the first pieces of gear its table offers. */
const trophyWorld: World = (fake, instance) => {
  full(fake, instance);
  const kinds = instance.trophies.kinds;
  const owner = fake.seed.account('story-owner');
  const mask = fake.seed.character(owner, 'Dr. Bones', instance.classes[0]!.key, { at: T0 });
  const rival = fake.seed.character(fake.seed.account('story-rival'), 'Sock Puppet', instance.classes[0]!.key, { at: T0 });
  const belt = kinds.find((k) => k.belt) ?? kinds[0]!;
  fake.seed.award(rival, belt.key, { at: T0 + 10 * 86_400_000, by: 'admin' });
  fake.seed.award(mask, belt.key, { at: T0 + 20 * 86_400_000, by: 'boss' });
  kinds.filter((k) => k.key !== belt.key).slice(0, 3).forEach((k, i) => fake.seed.award(mask, k.key, { at: T0 + (12 + i) * 86_400_000, by: i === 0 ? 'season' : 'admin', ...(i === 1 ? { line: 'Best walk cycle.' } : {}) }));
  fake.seed.avatar(mask, { square: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>', portrait: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><rect width="100" height="140"/></svg>' });
  const gear = instance.gear.slice(0, 3);
  fake.seed.gear(owner, Object.fromEntries(gear.map((g) => [g.key, 1])));
  fake.signInAs(owner);
  void fake.setOutfit(mask, gear.map((g, i) => ({ gear: g.key, x: 0.5, y: 0.1 + i * 0.25, w: 0.4, turn: 0, layer: i })));
};
export const TrophyCaseAndWearing: Story = { render: () => <Mine name="Dr. Bones" />, parameters: { world: trophyWorld, path: '/' } };
