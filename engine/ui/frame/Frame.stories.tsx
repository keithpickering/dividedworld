import type { Meta, StoryObj } from '@storybook/react-vite';
import { playerWorld, type World } from '../story.tsx';
import { Frame } from './Frame.tsx';

const meta: Meta<typeof Frame> = {
  title: 'Frame/Frame',
  component: Frame,
  args: {
    children: <p>A page.</p>,
  },
};
export default meta;

type Story = StoryObj<typeof Frame>;

export const SignedIn: Story = { parameters: { world: playerWorld } };
/*
 * For the owner's review: the HUD either side of the width where the Main board's layout becomes the
 * Phone board's, worked out from the instance's sizes (engine/ui/glass/board.ts; the viewports are
 * .storybook/preview.tsx's, 8px either side of it). Just above, the Main board's three groups drawn
 * at the window's scale; just below, the Phone board's HUD at the phone's sizes.
 */
export const DockedHudAboveSwitch: Story = {
  name: 'Docked HUD just above the switch: the Main board, scaled (owner review)',
  parameters: { world: playerWorld },
  globals: { viewport: { value: 'boardAboveSwitch', isRotated: false } },
};
export const DockedHudBelowSwitch: Story = {
  name: 'Docked HUD just below the switch: the Phone board (owner review)',
  parameters: { world: playerWorld },
  globals: { viewport: { value: 'boardBelowSwitch', isRotated: false } },
};
export const SignedOut: Story = { parameters: { world: () => {} } };
export const NoCharacterYet: Story = {
  parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('new-player')); }) satisfies World },
};
/* The HUD's mask hidden from the online lists (My characters' switch): its mark beside the class, or beside the mask on the phone. */
const hiddenWorld: World = (fake, instance) => {
  playerWorld(fake, instance);
  void fake.myCharacters().then((mine) => { const first = mine[0]; if (first) void fake.setPresenceHidden(first.id, true); });
};
export const HiddenFromOnlineLists: Story = { parameters: { world: hiddenWorld } };

/*
 * The HUD's Alerts button and the toasts above its seam (the alerts plan, Task 10; boards 01-board-toasts.html and 05-phone.html). The alerts
 * arrive a moment after the story opens, as they would live: three stay in the column, any more fold into "+N more", and the Alerts button shows
 * the count of what is new. Open the hand to see them wait.
 */
const arriving = (count: number): World => (fake, instance) => {
  playerWorld(fake, instance);
  const { seed } = fake;
  const friend = seed.account('story-friend');
  const theirs = seed.character(friend, 'Spritey', instance.classes[0]!.key);
  const kinds = ['ruling', 'trapStruck', 'trapSprang', 'ruling', 'trapStruck'] as const;
  const opening = seed.thread('general', theirs, 'who keeps splatting my posts', 'Somebody is doing it again.');
  void Promise.all([fake.session(), fake.myCharacters()]).then(([session, mine]) => {
    const account = session.account;
    const own = mine[0];
    if (!account || !own) return;
    setTimeout(() => {
      for (let i = 0; i < count; i++) seed.alert(account, { kind: kinds[i % kinds.length]!, act: opening.act, character: own.id, sub: i === 0 ? 'warning' : undefined });
    }, 1200);
  });
};
export const WithToasts: Story = { name: 'Alerts button and three toasts (owner review)', parameters: { world: arriving(3) } };
export const WithMoreToasts: Story = { name: 'Alerts button, three toasts and "+2 more" (owner review)', parameters: { world: arriving(5) } };
export const WithToastsOnThePhone: Story = {
  name: 'Alerts bell and toasts on the Phone board (owner review)',
  parameters: { world: arriving(4) },
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
