/**
 * Updates as an admin with Write an update, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/38-write-update.html`
 * (1440 wide) and the second screen of `39-admin-phone.html` (390 by 844): the screen itself in the glass's page shell, as the route /updates puts it
 * (web/src/App.tsx), signed in as an admin with no update posted yet. Write an update opens as an admin presses it, and its title, words and change
 * are typed by the manifest (e2e/boards/2026-11-05-backfill/37-admin-queue.ts and 38-write-update.ts), as an admin types them; nothing is posted.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { UpdatesScreen } from '../updates/Updates.tsx';

/** An admin with a character and no update posted yet, so the page holds the writer alone. */
const writer: World = (fake, instance) => {
  const me = fake.seed.account('story-admin', { admin: true });
  fake.seed.character(me, 'Admin Alex', instance.classes[0]!.key);
  fake.signInAs(me);
};

function UpdatesStory() {
  return <Page surface="settings"><UpdatesScreen /></Page>;
}

const meta: Meta<typeof UpdatesStory> = {
  title: 'Boards/00 Write update',
  component: UpdatesStory,
  parameters: { world: writer, path: '/updates', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof UpdatesStory>;

/** Updates on the Main board's layout, at 1440 wide. */
export const WriteUpdate: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const WriteUpdatePhone: Story = {
  name: 'Write update, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
