/**
 * Sign in and Register, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/14-sign-in.html` and `15-register.html`
 * (1440 wide) and `18-door-phone.html` (390 by 844): the screen itself (`SignInScreen`) in the glass's page shell, as the routes /sign-in and
 * /register put it (web/src/App.tsx), signed out, with Register opened from an invite link so its invite is filled in.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { TEST_LINK } from '../data/fake.ts';
import { Page } from '../glass/Page.tsx';
import { playerWorld, type World } from '../story.tsx';
import { SignInScreen } from './SignIn.tsx';

/** No one signed in: who the door is for. */
const visitor: World = () => {};

function DoorStory({ mode }: { readonly mode: 'sign-in' | 'register' }) {
  return <Page surface="account"><SignInScreen mode={mode} /></Page>;
}

const meta: Meta<typeof DoorStory> = {
  title: 'Boards/00 Sign in',
  component: DoorStory,
  parameters: { world: visitor, layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof DoorStory>;

const phone = { viewport: { value: 'glassPhone390', isRotated: false } } as const;

/** Sign in on the Main board's layout, at 1440 wide. */
export const SignIn: Story = { args: { mode: 'sign-in' }, parameters: { path: '/sign-in' } };
/** Register, opened from an invite link, at 1440 wide. */
export const Register: Story = { args: { mode: 'register' }, parameters: { path: '/register?invite=ab12cd34' } };
/** Sign in on the Phone board's layout, at 390 by 844. */
export const SignInPhone: Story = { name: 'Sign in, phone 390 × 844', args: { mode: 'sign-in' }, parameters: { path: '/sign-in' }, globals: phone };
/** Register on the Phone board's layout, at 390 by 844. */
export const RegisterPhone: Story = { name: 'Register, phone 390 × 844', args: { mode: 'register' }, parameters: { path: '/register?invite=ab12cd34' }, globals: phone };

/** The emailed link, as its button opens it: the panel stands where the form stands. */
const LINK = `#token_hash=${TEST_LINK}`;
/** A player whose address was the last asked for a code, so the story's link signs them in. */
const asked: World = (fake) => {
  fake.seed.account('story-link', { email: 'player@example.test' });
  void fake.requestCode('player@example.test', null, null);
};
/** A signed-in player, and the link of another address's code. */
const signedInAsked: World = (fake, instance) => { playerWorld(fake, instance); void fake.requestCode('player@example.test', null, null); };
/** The link opened where no one is signed in: one sentence, "Sign in", and "Use a code instead". */
export const LinkReady: Story = { name: 'Link, ready', args: { mode: 'sign-in' }, parameters: { world: asked, path: `/sign-in${LINK}` } };
/** The link opened in a browser that is signed in already: it names that address and asks. */
export const LinkAlreadySignedIn: Story = {
  name: 'Link, already signed in',
  args: { mode: 'sign-in' },
  parameters: { world: signedInAsked, path: `/sign-in${LINK}` },
};
/** The press has signed in: the panel names the address, with Continue and "Not you? Sign out". */
export const LinkSignedIn: Story = {
  name: 'Link, signed in',
  args: { mode: 'sign-in' },
  parameters: { world: asked, path: `/sign-in${LINK}` },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Sign in' }));
    await expect(await within(canvasElement).findByText(/^You are signed in as /u)).toBeInTheDocument();
  },
};
