/**
 * The wardrobe, drawn as a story against board 02 of the cosmetics design (`docs/research/2026-11-04-cosmetics/02-dressup.html`, 1440 by 1080): the screen in the
 * glass's page shell, as the route /wardrobe puts it, mid-arrangement. The player has three masks. Pipewrench (the mask the HUD acts as) wears the instance's
 * cap, mustache and button on a 1:2 portrait; Sock Puppet wears two more of the six mustaches and Dr. Bones the shades, so the cards say where each copy is.
 * The portraits are plain pictures of the board's shapes. The piece selected is the mustache, chosen in Worn now by the manifest's press
 * (e2e/boards/2026-11-04-cosmetics/02-dressup.ts). The pieces are the instance's own placeholders; the board draws its own (art.svg).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { Piece } from '../../rules/cosmetics.ts';
import { Page } from '../glass/Page.tsx';
import { usePlayer } from '../player.tsx';
import type { World } from '../story.tsx';
import { Wardrobe } from './Wardrobe.tsx';

const tall = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect width="100" height="200" fill="%238fd3f4"/><rect y="150" width="100" height="50" fill="%235aa25a"/><ellipse cx="50" cy="62" rx="22" ry="25" fill="%23f2c9a0"/><path d="M28 98 Q50 86 72 98 L80 160 L20 160 Z" fill="%233b5bdb"/><rect x="30" y="158" width="16" height="36" fill="%23222"/><rect x="54" y="158" width="16" height="36" fill="%23222"/></svg>';
const square = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%238fd3f4"/><ellipse cx="50" cy="62" rx="22" ry="25" fill="%23f2c9a0"/></svg>';

/** The board's pieces on its 1:2 portrait: the cap reaching above the slot, turned; the mustache; the button, turned the other way. */
const PIPEWRENCH: readonly Piece[] = [
  { gear: 'baseball-cap', x: 0.5, y: 0.055, w: 0.76, turn: -8, layer: 0 },
  { gear: 'mustache', x: 0.5, y: 0.38, w: 0.4, turn: 0, layer: 1 },
  { gear: 'button', x: 0.69, y: 0.605, w: 0.26, turn: 14, layer: 2 },
];

const arranging: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const cls = instance.classes[0]!.key;
  const bones = fake.seed.character(me, 'Dr. Bones', (instance.classes[1] ?? instance.classes[0]!).key);
  const sock = fake.seed.character(me, 'Sock Puppet', cls);
  const pipe = fake.seed.character(me, 'Pipewrench', cls);
  for (const c of [pipe, sock, bones]) fake.seed.avatar(c, { square, portrait: tall });
  fake.seed.gear(me, { 'baseball-cap': 2, mustache: 6, button: 1, shades: 1, 'nostalgic-hat': 1 });
  fake.signInAs(me);
  void fake.setOutfit(pipe, PIPEWRENCH);
  void fake.setOutfit(sock, [{ gear: 'mustache', x: 0.5, y: 0.38, w: 0.4, turn: 0, layer: 0 }, { gear: 'mustache', x: 0.5, y: 0.5, w: 0.4, turn: 0, layer: 1 }]);
  void fake.setOutfit(bones, [{ gear: 'shades', x: 0.5, y: 0.3, w: 0.5, turn: 0, layer: 0 }]);
};

/** The page opens on the mask the HUD acts as; the roster lists Dr. Bones first, so the story picks Pipewrench as a player would. */
function WardrobePage() {
  const { characters, hudCharacter, setHudCharacter } = usePlayer();
  const pipe = characters.find((c) => c.name === 'Pipewrench')?.id;
  useEffect(() => { if (pipe !== undefined && hudCharacter?.id !== pipe) setHudCharacter(pipe); }, [pipe, hudCharacter?.id, setHudCharacter]);
  return <Page surface="settings"><Wardrobe /></Page>;
}

const meta: Meta<typeof WardrobePage> = {
  title: 'Boards/00 Wardrobe',
  component: WardrobePage,
  parameters: { world: arranging, path: '/wardrobe', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof WardrobePage>;

/** The page at 1440 wide, Pipewrench dressed in the cap, the mustache and the button. */
export const Arranging: Story = {};
