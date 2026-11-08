/**
 * Reach a person, at /contact (the onboarding follow-ups plan, Task 8), for the owner to read in review: the admins' links as an admin set them,
 * and the page before any are set. Signed out, as the player who cannot sign in meets it. The words are the engine's and the links are made up here.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { LoadedContact } from '../loaded.tsx';

const meta: Meta = { title: 'Contact' };
export default meta;

export const Set: StoryObj = {
  render: () => <LoadedContact />,
  parameters: {
    path: '/contact',
    world: ((fake) => {
      fake.seed.contact([
        { label: 'Discord', href: 'https://discord.example/users/admin' },
        { label: 'Email', href: 'admin@example.test' },
        { label: 'The forum thread', href: 'https://forum.example/threads/12345' },
      ]);
    }) satisfies World,
  },
};

export const Unset: StoryObj = { render: () => <LoadedContact />, parameters: { path: '/contact' } };
