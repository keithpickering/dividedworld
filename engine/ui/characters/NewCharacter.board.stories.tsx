/**
 * New character, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/23-new-character.html` (1440 wide) and the first
 * screen of `27-characters-phone.html` (390 by 844): the screen itself in the glass's page shell, as the route /characters/new puts it
 * (web/src/App.tsx), for a player with room for another character. The boards' typed name and chosen class are pressed on by the manifest
 * (e2e/boards/2026-11-05-backfill/23-new-character.ts), as a player reaches them.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { NewCharacter } from './NewCharacter.tsx';

/** A player who plays one character and can make more. */
const player: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  fake.signInAs(me);
};

function NewCharacterStory() {
  return <Page surface="characters"><NewCharacter /></Page>;
}

const meta: Meta<typeof NewCharacterStory> = {
  title: 'Boards/00 New character',
  component: NewCharacterStory,
  parameters: { world: player, path: '/characters/new', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof NewCharacterStory>;

/** New character on the Main board's layout, at 1440 wide. */
export const NewCharacterForm: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const NewCharacterPhone: Story = {
  name: 'New character, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
