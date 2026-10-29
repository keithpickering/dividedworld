import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { World } from '../story.tsx';
import { usePlayer } from '../player.tsx';
import { ProfileEdit } from './ProfileEdit.tsx';

/** The edit page, opened on the HUD's character (the seed makes the character; no address names it). */
function FirstCharacter() {
  const { characters, loaded } = usePlayer();
  const { api } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => { void api.session().then(() => setReady(true)); }, [api]);
  const first = characters[0];
  return loaded && ready && first ? <ProfileEdit /> : <div aria-busy="true" />;
}

const meta: Meta<typeof FirstCharacter> = { title: 'Characters/Profile edit', component: FirstCharacter };
export default meta;

export const EditProfile: StoryObj<typeof FirstCharacter> = {
  parameters: {
    world: ((fake, instance) => {
      const me = fake.seed.account('story-player');
      fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
      fake.signInAs(me);
    }) satisfies World,
  },
};
