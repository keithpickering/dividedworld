/**
 * Settings › The board, drawn as stories against the board look boards `docs/research/2026-11-06-board-look/19-theme-picker.html` (House chosen),
 * `20-theme-picker-one-mode.html` (Hot Rod chosen, the Mode row held to dark) and `21-theme-picker-phone.html` (390 by 844): the screen itself
 * (`SettingsScreen`) in the glass's page shell, as the route /settings?section=board puts it, signed in.
 *
 * The five themes are the instance's own: the composition root (.storybook/preview.tsx) hands every story the instance's `InstanceUi`, so
 * the tiles and the miniature are drawn from its theme files, as the app draws them, and this story names no instance and holds no color.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { SettingsScreen } from './Settings.tsx';

const signedIn = (theme?: string): World => (fake) => {
  const me = fake.seed.account('story-player', { email: 'demo-player@example.test' });
  fake.signInAs(me);
  /* The fake answers a preference at once (no await in it), so the choice is held before the screen reads it. */
  if (theme) void fake.setPreferences({ theme });
};

function PickerStory() {
  return <Page surface="account"><SettingsScreen /></Page>;
}

const meta: Meta<typeof PickerStory> = {
  title: 'Boards/19 Theme picker',
  component: PickerStory,
  parameters: { world: signedIn(), path: '/settings?section=board', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof PickerStory>;

/** Settings › The board with the house theme chosen, at 1440 wide (board 19). */
export const Picker: Story = {};
/** The same with Hot Rod chosen, a theme that holds one mode: the Mode row held to dark, and says why (board 20). */
export const OneMode: Story = { name: 'One mode', parameters: { world: signedIn('hot-rod') } };
/** The Phone board's layout, at 390 by 844 (board 21's first screen). */
export const PickerPhone: Story = { name: 'Picker, phone 390 × 844', globals: { viewport: { value: 'glassPhone390', isRotated: false } } };
/** The phone with Hot Rod chosen (board 21's second screen). */
export const OneModePhone: Story = { name: 'One mode, phone 390 × 844', parameters: { world: signedIn('hot-rod') }, globals: { viewport: { value: 'glassPhone390', isRotated: false } } };
