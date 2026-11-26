/**
 * My characters and its dialogs, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/`: `25-reveal.html` (the Reveal
 * overlay) and, on the Phone board's layout (`27-characters-phone.html`, 390 by 844), My characters' head. The screen is My characters in the glass's
 * page shell, as the route /characters puts it (web/src/App.tsx); each manifest presses on the button that opens the dialog, as a player does
 * (e2e/boards/2026-11-05-backfill/). The world is one character alone, so the page opens on it.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { LoadedCharacters } from '../loaded.tsx';

/** One Heel: the Reveal overlay's world. Its class is the second the instance lists, as the board's Heel is. */
const pipewrench: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', (instance.classes[1] ?? instance.classes[0]!).key);
  fake.signInAs(me);
};

/** Three of the six characters a player may play, as the phone board's My characters has it. */
const three: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const [a, b, c] = instance.classes;
  fake.seed.character(me, 'Pipewrench', a!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key);
  fake.seed.character(me, 'Spritey', (c ?? a)!.key);
  fake.signInAs(me);
};

function CharactersStory() {
  return <Page surface="characters"><LoadedCharacters /></Page>;
}

const meta: Meta<typeof CharactersStory> = {
  title: 'Boards/00 Characters',
  component: CharactersStory,
  parameters: { world: pipewrench, path: '/characters', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof CharactersStory>;

const phone = { viewport: { value: 'glassPhone390', isRotated: false } } as const;

/** My characters with one character: the manifest presses on Reveal its class (board 25). */
export const Debuted: Story = {};
/** My characters' head on the Phone board's layout, at 390 by 844. */
export const CharactersPhone: Story = { name: 'My characters, phone 390 × 844', parameters: { world: three }, globals: phone };
