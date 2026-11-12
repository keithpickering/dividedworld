/**
 * A profile with its cosmetics, drawn as a story against board 03 of the cosmetics design (`docs/research/2026-11-04-cosmetics/03-trophy-case.html`, 1180 wide):
 * Pipewrench in its 1:2 portrait wearing the instance's cap, mustache and button, the Wearing row that names them in words, the trophy case (five awards, newest
 * first, each with who gave it and when, three shown on posts and the held belt) and the Hardcore Belt's lineage (three reigns). The pieces and badges are the
 * instance's own placeholders, and the portrait is a plain picture of the board's shape. The page is the profile screen as the route /c/:id draws it. Held by
 * e2e/boards/2026-11-04-cosmetics/03-trophy-case.ts.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import type { Piece } from '../../rules/cosmetics.ts';
import { useKayfa } from '../context.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedProfile } from '../loaded.tsx';
import type { World } from '../story.tsx';

const MIN = 60_000;
const OCT = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);
const NOV = (day: number, hour = 12) => Date.UTC(2026, 10, day, hour);

const tall = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect width="100" height="200" fill="%238fd3f4"/><rect y="150" width="100" height="50" fill="%235aa25a"/><ellipse cx="50" cy="62" rx="22" ry="25" fill="%23f2c9a0"/><path d="M28 98 Q50 86 72 98 L80 160 L20 160 Z" fill="%233b5bdb"/><rect x="30" y="158" width="16" height="36" fill="%23222"/><rect x="54" y="158" width="16" height="36" fill="%23222"/></svg>';
const square = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%238fd3f4"/><ellipse cx="50" cy="62" rx="22" ry="25" fill="%23f2c9a0"/></svg>';

/** The board's gear, by the instance's keys, as fractions of the 1:2 portrait. */
const OUTFIT: readonly Piece[] = [
  { gear: 'baseball-cap', x: 0.5, y: 0.055, w: 0.76, turn: -8, layer: 0 },
  { gear: 'mustache', x: 0.5, y: 0.38, w: 0.4, turn: 0, layer: 1 },
  { gear: 'button', x: 0.69, y: 0.605, w: 0.26, turn: 14, layer: 2 },
];

const world: World = (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const general = instance.boards.find((b) => !b.system)!.slug;
  const reader = fake.seed.account('story-reader');
  const wrench = fake.seed.account('story-wrench');
  const pipewrench = fake.seed.character(wrench, 'Pipewrench', cls, { at: OCT(8) });
  const sock = fake.seed.character(fake.seed.account('story-sock'), 'Sock Puppet', cls, { at: OCT(1) });
  const bones = fake.seed.character(fake.seed.account('story-bones'), 'Dr. Bones', cls, { at: OCT(1) });
  /* The 212 posts the board counts. */
  const filler = fake.seed.thread(general, sock, 'Old business', 'Nothing to see.', { at: OCT(9) });
  for (let i = 0; i < 212; i++) fake.seed.post(filler.thread, pipewrench, `Filler ${i + 1}.`, { at: OCT(10) + i * MIN });
  fake.seed.settle({ at: NOV(3), standings: { [pipewrench]: 650 } });
  fake.seed.avatar(pipewrench, { square, portrait: tall });
  fake.seed.gear(wrench, { 'baseball-cap': 1, mustache: 1, button: 1 });
  /* The case, newest first: the belt (taken from Sock Puppet on Nov 2; Dr. Bones held it first), then four more. */
  fake.seed.award(bones, 'hardcore-belt', { at: OCT(9), by: 'admin' });
  fake.seed.award(sock, 'hardcore-belt', { at: OCT(18), by: 'boss' });
  fake.seed.award(pipewrench, 'hardcore-belt', { at: NOV(2), by: 'boss' });
  const month = fake.seed.award(pipewrench, 'employee-of-the-month', { at: OCT(30), by: 'admin', line: 'Best walk cycle.' });
  const pet = fake.seed.award(pipewrench, 'bosss-pet', { at: OCT(21), by: 'boss' });
  fake.seed.award(pipewrench, 'met-the-bosss-demand', { at: OCT(14), by: 'demand', line: '12 characters post in Tomato Talk' });
  const champion = fake.seed.award(pipewrench, 'season-champion', { at: OCT(1), by: 'season' });
  fake.signInAs(wrench);
  void fake.setOutfit(pipewrench, OUTFIT);
  void fake.setProfile(pipewrench, 'Professional Wrench', '', instance.pipStyles[0]?.key ?? 'default');
  void fake.showTrophies(pipewrench, [champion, pet, month]);
  fake.signInAs(reader);
};

function PipewrenchProfile() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { void api.standingsPage(0, 1).then((r) => setId(r[0]?.character ?? 'nobody')); }, [api]);
  return <Frame>{id === null ? null : <LoadedProfile id={id} />}</Frame>;
}

const meta: Meta<typeof PipewrenchProfile> = {
  title: 'Boards/03 Trophy case',
  component: PipewrenchProfile,
  parameters: { world, path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof PipewrenchProfile>;

/** Pipewrench's profile on the Main board's layout, wearing gear and holding the belt. */
export const TrophyCase: Story = {};
