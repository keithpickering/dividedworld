/**
 * Edit profile, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/26-edit-profile.html` (1440 wide) and the third
 * screen of `27-characters-phone.html` (390 by 844): the screen itself in the glass's page shell, as the route /characters/edit puts it
 * (web/src/App.tsx), for a player whose one character is Mrs. Hooligan. The boards' title and signature are typed by the manifest
 * (e2e/boards/2026-11-05-backfill/26-edit-profile.ts), as a player types them, so the live postbit follows them.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { LoadedCharacters } from '../loaded.tsx';

/** One character, debuted, with no avatar yet: the board's "No picture yet." */
const hooligan: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Mrs. Hooligan', (instance.classes[1] ?? instance.classes[0]!).key);
  fake.signInAs(me);
};

function ProfileEditStory() {
  return <Page surface="characters"><LoadedCharacters /></Page>;
}

const meta: Meta<typeof ProfileEditStory> = {
  title: 'Boards/00 Edit profile',
  component: ProfileEditStory,
  parameters: { world: hooligan, path: '/characters/edit', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof ProfileEditStory>;

/** Edit profile on the Main board's layout, at 1440 wide. */
export const EditProfile: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const EditProfilePhone: Story = {
  name: 'Edit profile, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
