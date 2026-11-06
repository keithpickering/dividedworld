/**
 * Settings › Account, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/33-settings-account.html` (1440 wide) and
 * `36-account-phone.html` (its first screen, 390 by 844): the screen itself (`SettingsScreen`) in the glass's page shell, as the route /settings puts it
 * (web/src/App.tsx), signed in, with the board's state: two invites made, one open and one used.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { SettingsScreen } from './Settings.tsx';

/**
 * A player with two invites: the one made Nov 5 is open (it expires Nov 12, a week on) and the one made Nov 2 has been used. The seed's own
 * clock stands at Oct 29, so both are dated ahead of it and the open one is not yet near its expiry.
 */
const twoInvites: World = (fake) => {
  const me = fake.seed.account('story-player', { email: 'demo-player@example.test' });
  fake.seed.invite(me, { at: Date.UTC(2026, 10, 2, 12), used: true });
  fake.seed.invite(me, { at: Date.UTC(2026, 10, 5, 12) });
  fake.signInAs(me);
};

function AccountStory() {
  return <Page surface="account"><SettingsScreen /></Page>;
}

const meta: Meta<typeof AccountStory> = {
  title: 'Boards/00 Settings account',
  component: AccountStory,
  parameters: { world: twoInvites, path: '/settings?section=account', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof AccountStory>;

/** Settings › Account on the Main board's layout, at 1440 wide. */
export const Account: Story = {};
/** The same screen on the Phone board's layout, at 390 by 844. */
export const AccountPhone: Story = { name: 'Account, phone 390 × 844', globals: { viewport: { value: 'glassPhone390', isRotated: false } } };

