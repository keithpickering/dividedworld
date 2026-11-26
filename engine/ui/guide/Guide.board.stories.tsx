/**
 * The Strategy Guide, drawn as stories against the boards `docs/research/2026-11-02-onboarding/02-guide.html` (the guide scrolled to
 * Classes, at 1440 wide) and `04-phone.html` (the same section on the Phone board's layout at 390 by 844, the contents folded into a menu).
 * The page is the screen itself (`GuideScreen`) in the glass's page shell, as the route /guide puts it (web/src/App.tsx), signed in, and
 * opened at the Classes anchor as the board is. Every word on it is the instance's own Markdown and its live classes, cards and settings
 * (the preview builds the backend from the instance, which names them), so the board's five classes (the instance's six), their marks and hints are the
 * instance's, not this story's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KayfaProvider, useKayfa } from '../context.tsx';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { GuideScreen } from './Guide.tsx';

/** A signed-in player: the guide is the board's, and a signed-out visitor sees the sign-in prompt in its place. */
const player: World = (fake) => { fake.signInAs(fake.seed.account('player')); };

/** `systemEnabled` lays the instance's switch over the live settings, so the guide's conditional passages show as they do with the staff on or off. */
function GuideStory({ systemEnabled }: { readonly systemEnabled?: boolean }) {
  const kayfa = useKayfa();
  const page = <Page surface="settings"><GuideScreen /></Page>;
  return systemEnabled === undefined ? page : <KayfaProvider value={{ ...kayfa, settings: { ...kayfa.settings, systemEnabled } }}>{page}</KayfaProvider>;
}

const meta: Meta<typeof GuideStory> = {
  title: 'Boards/02 Guide',
  component: GuideStory,
  parameters: { world: player, path: '/guide#classes', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof GuideStory>;

/** The guide at Classes, on the Main board's layout, at 1440 wide. */
export const Classes: Story = {};
/** The same section on the Phone board's layout, at 390 by 844, the contents folded into a menu. */
export const ClassesPhone: Story = {
  name: 'Classes, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** From the top, with the welcome letter as its first section. */
export const Top: Story = { parameters: { path: '/guide' } };
/** From the top on the Phone board's layout, at 390 by 844: the title, the lede and the folded contents (the backfill's 22-onboarding-phone.html). */
export const TopPhone: Story = {
  name: 'Top, phone 390 × 844',
  parameters: { path: '/guide' },
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** From the top with the staff switched on: the passages written for `system-on` are drawn and those for `system-off` are not. */
export const StaffOn: Story = { args: { systemEnabled: true }, parameters: { path: '/guide' } };
/** From the top with the staff switched off: the reverse. */
export const StaffOff: Story = { args: { systemEnabled: false }, parameters: { path: '/guide' } };
