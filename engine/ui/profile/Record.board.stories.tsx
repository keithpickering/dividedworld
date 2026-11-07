/**
 * A character's public record, drawn as a story against the phone board 10 of the board look design (`docs/research/2026-11-06-board-look/10-phone.html`,
 * its third screen, 390 by 844): Spritey's record, newest first, a date above each row's words. The rows' days are the board's, Oct 18 to 29, dated in
 * the week before the backend's clock so a reader's "days ago" has turned to a date for a while (e2e/boards/2026-11-06-board-look/10-phone.ts compares it).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedRecord } from '../loaded.tsx';
import { spriteyWorld as world } from './spritey-world.ts';

/** The top of the standings, whatever id the story's world gave it. */
function RecordStory() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { void api.standingsPage(0, 1).then((r) => setId(r[0]?.character ?? 'nobody')); }, [api]);
  return <Frame>{id === null ? null : <LoadedRecord id={id} />}</Frame>;
}

const meta: Meta<typeof RecordStory> = {
  title: 'Boards/10 Record',
  component: RecordStory,
  parameters: { world, path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof RecordStory>;

/** Spritey's public record on the Main board's layout. */
export const Record: Story = {};
