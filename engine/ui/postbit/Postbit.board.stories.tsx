/**
 * Gear and trophies on a post, drawn as a story against board 01 of the cosmetics design (`docs/research/2026-11-04-cosmetics/01-postbit.html`, 1180 wide):
 * the thread "official hat thread v2" with the side postbit of Pipewrench (a 1:2 portrait wearing the instance's cap, mustache and button, three chosen
 * trophies and the held Hardcore Belt) and Dr. Bones (a 1:1.4 portrait in the Nostalgic Hat and shades, one trophy), then the stacked band's square with
 * the same gear cut at its edge. The pieces and badges are the instance's own placeholders (the board draws its own placeholders, art.svg), and the
 * portraits are drawn here as plain pictures of the board's shapes. Held by e2e/boards/2026-11-04-cosmetics/01-postbit.ts.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import type { Piece } from '../../rules/cosmetics.ts';
import { useKayfa } from '../context.tsx';
import type { Character } from '../data/api.ts';
import { LoadedThread } from '../loaded.tsx';
import type { World } from '../story.tsx';
import { Postbit } from './Postbit.tsx';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 4, 20, 0);
const NOV = (day: number, hour = 12) => Date.UTC(2026, 10, day, hour);
const OCT = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);

/** The board's portraits, as pictures of their shapes: a figure on sky cut 1:2, and one on pink cut 1:1.4. */
const tall = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect width="100" height="200" fill="%238fd3f4"/><rect y="150" width="100" height="50" fill="%235aa25a"/><ellipse cx="50" cy="62" rx="22" ry="25" fill="%23f2c9a0"/><path d="M28 98 Q50 86 72 98 L80 160 L20 160 Z" fill="%233b5bdb"/><rect x="30" y="158" width="16" height="36" fill="%23222"/><rect x="54" y="158" width="16" height="36" fill="%23222"/></svg>';
const shorter = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><rect width="100" height="140" fill="%23f4b6c2"/><ellipse cx="50" cy="58" rx="24" ry="27" fill="%23c99366"/><path d="M22 100 Q50 88 78 100 L86 140 L14 140 Z" fill="%232f9e44"/></svg>';
const square = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%238fd3f4"/><ellipse cx="50" cy="62" rx="22" ry="25" fill="%23f2c9a0"/></svg>';

/** The board's pieces of gear, by the instance's keys and as fractions of the 1:2 portrait (the cap reaching above the slot, turned; the button turned the other way). */
const PIPEWRENCH: readonly Piece[] = [
  { gear: 'baseball-cap', x: 0.5, y: 0.055, w: 0.76, turn: -8, layer: 0 },
  { gear: 'mustache', x: 0.5, y: 0.38, w: 0.4, turn: 0, layer: 1 },
  { gear: 'button', x: 0.69, y: 0.605, w: 0.26, turn: 14, layer: 2 },
];
/** Dr. Bones's, on the 1:1.4 portrait: a hat reaching above the slot and shades over the eyes. */
const BONES: readonly Piece[] = [
  { gear: 'nostalgic-hat', x: 0.5, y: 0.05, w: 0.48, turn: 0, layer: 0 },
  { gear: 'shades', x: 0.5, y: 0.4, w: 0.54, turn: 0, layer: 1 },
];

const world: World = (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const general = instance.boards.find((b) => !b.system)!.slug;
  const reader = fake.seed.account('story-reader');
  const wrench = fake.seed.account('story-wrench');
  const bones = fake.seed.account('story-bones');
  const pipewrench = fake.seed.character(wrench, 'Pipewrench', cls, { at: OCT(8) });
  const drBones = fake.seed.character(bones, 'Dr. Bones', cls, { at: NOV(2) });
  const sock = fake.seed.character(fake.seed.account('story-sock'), 'Sock Puppet', cls, { at: OCT(1) });
  /* The posts the board counts (212 and 31), on a thread of their own, before the one drawn. */
  const filler = fake.seed.thread(general, sock, 'Old business', 'Nothing to see.', { at: OCT(9) });
  for (let i = 0; i < 211; i++) fake.seed.post(filler.thread, pipewrench, `Filler ${i + 1}.`, { at: OCT(10) + i * MIN });
  for (let i = 0; i < 30; i++) fake.seed.post(filler.thread, drBones, `Filler ${i + 1}.`, { at: NOV(2, 13) + i * MIN });
  const hats = fake.seed.thread(general, pipewrench, 'official hat thread v2', "it's not a hat thread if nobody's wearing a hat. anyway here's my cap. found it on the ground behind the vending machine", { at: T0 + 12 * MIN });
  fake.seed.post(hats.thread, drBones, 'this portrait is shorter than yours and the hat still fits. checkmate', { at: T0 + 20 * MIN });
  fake.seed.settle({ at: NOV(3), standings: { [pipewrench]: 650, [drBones]: 40 } });
  fake.seed.avatar(pipewrench, { square, portrait: tall });
  fake.seed.avatar(drBones, { square, portrait: shorter });
  fake.seed.gear(wrench, { 'baseball-cap': 1, mustache: 1, button: 1 });
  fake.seed.gear(bones, { 'nostalgic-hat': 1, shades: 1 });
  /* Three chosen trophies and a held belt under the rank; the belt was Sock Puppet's, and the Boss moved it to Pipewrench on Nov 2. */
  const champion = fake.seed.award(pipewrench, 'season-champion', { at: OCT(1), by: 'season' });
  const pet = fake.seed.award(pipewrench, 'bosss-pet', { at: OCT(21), by: 'boss' });
  const month = fake.seed.award(pipewrench, 'employee-of-the-month', { at: OCT(30), by: 'admin', line: 'Best walk cycle.' });
  fake.seed.award(sock, 'hardcore-belt', { at: OCT(18), by: 'boss' });
  fake.seed.award(pipewrench, 'hardcore-belt', { at: NOV(2), by: 'boss' });
  const demand = fake.seed.award(drBones, 'met-the-bosss-demand', { at: OCT(14), by: 'demand' });
  fake.signInAs(wrench);
  void fake.setOutfit(pipewrench, PIPEWRENCH);
  void fake.setProfile(pipewrench, 'Professional Wrench', '', instance.pipStyles[0]?.key ?? 'default');
  void fake.showTrophies(pipewrench, [champion, pet, month]);
  fake.signInAs(bones);
  void fake.setOutfit(drBones, BONES);
  void fake.setProfile(drBones, 'no relation', '', instance.pipStyles[0]?.key ?? 'default');
  void fake.showTrophies(drBones, [demand]);
  fake.signInAs(reader);
};

/** The board's stacked band: the same mask on the square, the 1:2 portrait's top half (its frame), the belt as a badge. */
function Band() {
  const { instance } = useKayfa();
  const character: Character = {
    id: 'story-band', name: 'Pipewrench', title: 'Professional Wrench', signature: '', avatarSquare: square, avatarPortrait: tall,
    squareFrame: { x: 0, y: 0, w: 1, h: 0.5 }, portraitFrame: null, portraitTallness: 2, outfit: PIPEWRENCH, trophies: [{ award: 'story-belt', trophy: 'hardcore-belt', name: 'The Hardcore Belt', art: null, belt: true, held: true }], pipStyle: instance.pipStyles[0]?.key ?? 'default',
    pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'members',
  };
  return <Postbit person={{ character, posts: 212, standing: 650, revealed: null, turnedAt: null }} layout="stacked" />;
}

function PostbitStory() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === 'official hat thread v2');
        if (found) { setId(found.id); return; }
      }
      setId('missing');
    })();
  }, [api]);
  if (id === 'missing') return <p role="alert">The story's world has no hat thread.</p>;
  return id ? <><LoadedThread thread={id} /><Band /></> : <div aria-busy="true" />;
}

const meta: Meta<typeof PostbitStory> = {
  title: 'Boards/01 Postbit gear',
  component: PostbitStory,
  parameters: { world, path: '/t/x', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof PostbitStory>;

/** The two posts with the side postbit, then the stacked band, on the Main board's layout. */
export const GearAndTrophies: Story = {};
