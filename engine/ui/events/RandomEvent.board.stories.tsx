/**
 * The Random Event dialog, drawn as a story against board 04 of the cosmetics design (`docs/research/2026-11-04-cosmetics/04-event.html`, 1440 by 1080): the dialog
 * opened over a page by a roll of a found gear, the instance's first gear (the cap, common) in the instance's own line, for the player's one mask, Pipewrench. The board's
 * forum under the dialog is not drawn here (the dialog is held on its own), and the two smaller states it insets (a line alone, a found card) are not further
 * screens of the board: the stories `Glass/Random Event` draw them. Held by e2e/boards/2026-11-04-cosmetics/04-event.ts.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { RandomEvent } from './RandomEvent.tsx';

const found: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  fake.signInAs(me);
  const line = instance.events.lines.find((l) => l.outcome === 'gear')?.key;
  fake.seed.nextEvent({ outcome: 'gear', item: instance.gear[0]!.key, ...(line === undefined ? {} : { line }) });
};

function EventPage() {
  return <Page surface="settings"><RandomEvent /></Page>;
}

const meta: Meta<typeof EventPage> = {
  title: 'Boards/00 Random Event',
  component: EventPage,
  parameters: { world: found, path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof EventPage>;

/** The dialog open on a found gear, at 1440 wide. */
export const GearFound: Story = {};
