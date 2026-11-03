/**
 * The welcome page, drawn as stories against the boards `docs/research/2026-11-02-onboarding/01-welcome.html` (1440 wide) and `04-phone.html`
 * (the welcome stacked on the Phone board's layout, 390 by 844). The page is the screen itself (`WelcomeScreen`) in the glass's page shell,
 * as the route /welcome puts it (web/src/App.tsx), signed in. The letter, the persona's name, tagline and picture are the instance's own
 * (the preview builds the backend and the words from the instance); the side column and the settings rows are the engine's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { WelcomeScreen } from './Welcome.tsx';

/** A signed-in player with no character yet: who the welcome is for. */
const newcomer: World = (fake) => { fake.signInAs(fake.seed.account('newcomer')); };

function WelcomeStory() {
  return <Page surface="settings"><WelcomeScreen /></Page>;
}

const meta: Meta<typeof WelcomeStory> = {
  title: 'Boards/01 Welcome',
  component: WelcomeStory,
  parameters: { world: newcomer, path: '/welcome', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof WelcomeStory>;

/** The welcome on the Main board's layout, at 1440 wide. */
export const Welcome: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const WelcomePhone: Story = {
  name: 'Welcome, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
