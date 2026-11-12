import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { Wardrobe } from './Wardrobe.tsx';

/** The dress-up page in the glass's page shell, as the route /wardrobe puts it. */
function WardrobePage() {
  return <Page surface="settings"><Wardrobe /></Page>;
}

const meta: Meta<typeof WardrobePage> = { title: 'Characters/Wardrobe', component: WardrobePage, parameters: { layout: 'fullscreen' } };
export default meta;

type Story = StoryObj<typeof WardrobePage>;

/** A player with two masks, a portrait on the first, and one or two of each of the instance's gear (the seed names none of it). */
const dressed: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const pipe = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (instance.classes[1] ?? instance.classes[0]!).key);
  fake.seed.avatar(pipe, { square: 'about:blank', portrait: 'about:blank' });
  fake.seed.gear(me, Object.fromEntries(instance.gear.map((g, i) => [g.key, (i % 2) + 1])));
  fake.signInAs(me);
};

export const Dressing: Story = { parameters: { path: '/wardrobe', world: dressed } };
