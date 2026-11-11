/**
 * Updates, drawn as a story against the board `docs/research/2026-11-02-alerts/03-updates.html` (the alerts plan, Task 7): the open update is
 * the board's, "Traps now bite board cards", by the instance's developer persona, with its plain What changed list, three reactions and the
 * archive of the three before it. The page is the screen itself (`UpdatesScreen`) in the glass's page shell, as the route /updates puts it
 * (web/src/App.tsx), signed in as a player with a character. The words are the board's, and the persona and its picture are the instance's own
 * (the preview builds the backend from the instance, which names them: Gabe's face is the owner's sprite, drawn pixelated); the reactions are the instance's, by their place in its list.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { LoadedUpdates } from '../loaded.tsx';

const utc = (month: number, day: number, hour = 8) => Date.UTC(2026, month - 1, day, hour);

/** The board's four updates, the newest open, signed in as the player. */
const updates: World = (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const { seed } = fake;
  const me = seed.account('player');
  seed.character(me, 'Pipewrench', cls);
  seed.update({
    title: 'Welcome to the playtest', at: utc(10, 28),
    body: 'The doors are open. Be kind to the staff; they have been alone a long time.',
    changes: [{ label: 'Everything', text: 'is new, and some of it works.' }],
  });
  seed.update({
    title: 'Whoops! washes 20% faster, because you asked nicely', at: utc(10, 30),
    body: 'You asked, nicely, and then less nicely. A splat now washes a fifth faster.',
    changes: [{ label: 'Whoops!', text: 'washes 20% faster.' }],
  });
  seed.update({
    title: 'Season 2 is open, and so is the Vending Machine\'s back panel', at: utc(11, 1),
    body: 'Season 2 began at the stroke of the settlement. The Vending Machine\'s back panel is open for the same reason nobody can say.',
    changes: [{ label: 'Season 2', text: 'is open; every character starts again at zero.' }],
  });
  const newest = seed.update({
    title: 'Traps now bite board cards', at: utc(11, 2),
    body: 'Somebody played Main Event on a thread called “why is my thread pinned” and it stayed pinned for a full day while a perfectly good Card Collector sat underneath it doing nothing. The trap was right to be offended. As of this morning it can do something about it.\n\nAlso, the log was telling some of you that a Glitter Bomb landed on a post when it had landed on a person. The log is never supposed to lie, so it got a stern talking-to and a test.',
    changes: [
      { label: 'Card Collector', text: 'can now catch a card played on a thread or a board, not only on a post.' },
      { label: 'Main Event', text: 'lasts 18 hours instead of 24.' },
      { label: 'Fixed:', text: 'the log now names the character, thread or board a card was played on, and the character\'s player gets a line of their own.' },
    ],
  });
  const [a, b, c] = instance.reactions;
  seed.tally(newest, { [a!.key]: 9, [b!.key]: 4, [c!.key]: 2 });
  fake.signInAs(me);
};

/** The screen at /updates, in its page shell. */
function UpdatesStory() {
  return <Page surface="settings"><LoadedUpdates /></Page>;
}

const meta: Meta<typeof UpdatesStory> = {
  title: 'Boards/03 Updates',
  component: UpdatesStory,
  parameters: { world: updates, path: '/updates', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof UpdatesStory>;

/** The newest update open, on the Main board's layout, at 1440 wide. */
export const Newest: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const NewestPhone: Story = {
  name: 'Newest, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** Before the developers have posted anything. */
export const Empty: Story = {
  parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('player')); }) satisfies World },
};
