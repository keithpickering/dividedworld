import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { LoadedCharacters } from '../loaded.tsx';

/** The edit page, opened on the HUD's character (the seed makes the character; no address names it). */
function FirstCharacter() {
  return <LoadedCharacters />;
}

const meta: Meta<typeof FirstCharacter> = { title: 'Characters/Profile edit', component: FirstCharacter };
export default meta;

export const EditProfile: StoryObj<typeof FirstCharacter> = {
  parameters: {
    path: '/characters/edit',
    world: ((fake, instance) => {
      const me = fake.seed.account('story-player');
      fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
      fake.signInAs(me);
    }) satisfies World,
  },
};
