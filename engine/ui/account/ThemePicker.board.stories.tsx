/**
 * Settings › The board, drawn as stories against the board look boards `docs/research/2026-11-06-board-look/19-theme-picker.html` (House chosen),
 * `20-theme-picker-one-mode.html` (Hot Rod chosen, the Mode row held to dark) and `21-theme-picker-phone.html` (390 by 844): the screen itself
 * (`SettingsScreen`) in the glass's page shell, as the route /settings?section=board puts it, signed in.
 *
 * The boards show five themes. The instance offers House alone until the tribute themes land (the board look plan, Task 17), so these stories
 * add four test themes of their own after the instance's house theme, with the names and the colors the boards draw, as a story may: it
 * never names an instance, and it hands the screen a longer theme list through the same context the app does. Hot Rod, the one-mode board's
 * choice, is one of them. When Task 17 adds the real four, these are the stand-ins to replace them with.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { KayfaProvider, useKayfa } from '../context.tsx';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import type { ThemeOption, ThemePreview } from '../types.ts';
import { SettingsScreen } from './Settings.tsx';

/** One test theme's tokens as the boards draw them (gen.mjs's THEMES): the miniature's own names, the button the boards draw by default. */
const tokens = (t: { page: string; banner: string; logo: string; nav: string; navfg: string; head: string; headfg: string; grid: string; r1: string; r2: string; r3: string; fg: string; link: string; button?: string }): ThemePreview => ({
  '--kb-bg': t.page, '--kb-fg': t.fg, '--kb-link': t.link, '--kb-grid': t.grid, '--kb-frame': t.grid,
  '--kb-banner-bg': t.banner, '--kb-logo-fg': t.logo, '--kb-nav-bg': t.nav, '--kb-nav-fg': t.navfg,
  '--kb-head-bg': t.head, '--kb-head-fg': t.headfg, '--kb-row-1': t.r1, '--kb-row-2': t.r2, '--kb-row-3': t.r3,
  '--kb-button-bg': t.button ?? 'linear-gradient(#fcfcfc,#d8d8d8 48%,#b4b4b4 52%,#e6e6e6)', '--kb-button-edge': '#3a3a3a', '--kb-button-fg': '#111111',
});

const STAND_INS = (href: string): readonly ThemeOption[] => [
  { key: 'blue-steel', name: 'Blue Steel', href, modes: 'light', preview: { light: tokens({ page: '#e5e5e5', banner: 'linear-gradient(#fff,#dee3e7)', logo: '#00507a', nav: '#d1d7dc', navfg: '#00507a', head: 'linear-gradient(#3b8ac2,#0b6aa1 50%,#005c8f 51%,#004a75)', headfg: '#ffc37a', grid: '#a9b8c2', r1: '#efefef', r2: '#dee3e7', r3: '#d1d7dc', fg: '#000', link: '#00507a' }) } },
  { key: 'midnight', name: 'Midnight', href, modes: 'dark', preview: { dark: tokens({ page: '#0c121b', banner: 'linear-gradient(#1f3046,#0c121b)', logo: '#eaf2fb', nav: '#16202c', navfg: '#9cc9ff', head: 'linear-gradient(#41658a,#2b4a6b 50%,#203a56 51%,#182c42)', headfg: '#eaf2fb', grid: '#2a3a4d', r1: '#1a2533', r2: '#16202c', r3: '#1f2d3d', fg: '#d8dee6', link: '#9cc9ff' }) } },
  { key: 'hot-rod', name: 'Hot Rod', href, modes: 'dark', preview: { dark: tokens({ page: '#000', banner: 'linear-gradient(#000 40%,#4a0e00 80%,#b82a00)', logo: '#ffcc00', nav: '#140906', navfg: '#ffcc00', head: 'linear-gradient(#ffe36a,#ffae00 35%,#ff5a00 65%,#b81200)', headfg: '#1a0500', grid: '#4a1606', r1: '#140906', r2: '#1d0d07', r3: '#26110a', fg: '#f2e6d8', link: '#ffcc00', button: 'radial-gradient(ellipse 75% 70% at 50% 45%,#f4f4f4,#d2d2d2 40%,#9c9c9c 82%,#6e6e6e)' }) } },
  { key: 'fan-site', name: 'Fan Site', href, modes: 'dark', preview: { dark: tokens({ page: '#000', banner: 'linear-gradient(90deg,#12207a,#1d36b8 60%,#12207a)', logo: '#ff3a2a', nav: '#05082a', navfg: '#ffff66', head: 'linear-gradient(#3a5be0,#1a2fa8 55%,#0a1468)', headfg: '#22d4ff', grid: '#0a1250', r1: '#2234a8', r2: '#1d2e98', r3: '#18268a', fg: '#c4d8ff', link: '#fff' }) } },
];

/** The instance's themes with the four stand-ins after them. */
function WithFiveThemes({ children }: { readonly children: ReactNode }) {
  const kayfa = useKayfa();
  const house = kayfa.ui.themes[0]!;
  return <KayfaProvider value={{ ...kayfa, ui: { ...kayfa.ui, themes: [house, ...STAND_INS(house.href)] } }}>{children}</KayfaProvider>;
}

const signedIn = (theme?: string): World => (fake) => {
  const me = fake.seed.account('story-player', { email: 'demo-player@example.test' });
  fake.signInAs(me);
  /* The fake answers a preference at once (no await in it), so the choice is held before the screen reads it. */
  if (theme) void fake.setPreferences({ theme });
};

function PickerStory() {
  return <WithFiveThemes><Page surface="account"><SettingsScreen /></Page></WithFiveThemes>;
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
