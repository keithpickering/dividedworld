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
import type { World } from '../story.tsx';

const OCT = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);

const world: World = (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const me = fake.seed.account('story-player', { seasoned: true });
  const spritey = fake.seed.character(fake.seed.account('story-other'), 'Spritey', cls, { at: OCT(1) });
  fake.seed.character(me, 'Mrs. Hooligan', cls, { at: OCT(1) });
  const general = instance.boards.find((b) => !b.system)!.slug;
  const first = fake.seed.thread(general, spritey, 'The long one', 'Where to begin.', { at: OCT(18) });
  fake.seed.post(first.thread, spritey, 'Post 168 of the long thread. Still going.', { at: OCT(19) });
  fake.seed.reveal(spritey, first.thread, { class: cls, at: OCT(20) });
  fake.seed.card(spritey, first.act, instance.cards[0]!.key, { at: OCT(22) });
  fake.seed.thread(general, spritey, 'who keeps splatting my posts', 'Again.', { at: OCT(27) });
  fake.seed.post(first.thread, spritey, 'Third time this week. I wrote four whole paragraphs about the new ink and it all went.', { at: OCT(29) });
  fake.seed.settle({ at: OCT(28), standings: { [spritey]: 185 }, wallet: { [me]: 240 } });
  fake.signInAs(me);
};

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
