/**
 * A character's profile, drawn as a story against board 08 of the board look design (`docs/research/2026-11-06-board-look/08-profile.html`, 1440 wide):
 * Spritey's "About" table (the facts as rows, each label a row header; the signature closing the card) and its public record's latest rows under their
 * band, See the full record at the right. The board's first phone screen (`10-phone.html`) is the same page at 390 (e2e/boards/2026-11-06-board-look/10-phone.ts
 * compares it). The trophy case, the lineage and the Wearing row are the cosmetics plan's (its Task 10) and are not drawn here.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedProfile } from '../loaded.tsx';
import { spriteyWorld as world } from './spritey-world.ts';

/** The top of the standings, whatever id the story's world gave it. */
function ProfileStory() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { void api.standingsPage(0, 1).then((r) => setId(r[0]?.character ?? 'nobody')); }, [api]);
  return <Frame>{id === null ? null : <LoadedProfile id={id} />}</Frame>;
}

const meta: Meta<typeof ProfileStory> = {
  title: 'Boards/08 Profile',
  component: ProfileStory,
  parameters: { world, path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof ProfileStory>;

/** Spritey's profile on the Main board's layout. */
export const Profile: Story = {};
