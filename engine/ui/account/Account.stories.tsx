import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Fake } from '../data/fake.ts';
import type { World } from '../story.tsx';
import { InvitesScreen } from './Invites.tsx';
import { SettingsScreen } from './Settings.tsx';
import { SignInScreen } from './SignIn.tsx';

const meta: Meta = { title: 'Account' };
export default meta;

const player = ((fake: Fake) => {
  const me = fake.seed.account('story-player');
  fake.signInAs(me);
}) satisfies World;

export const SignIn: StoryObj = { render: () => <SignInScreen mode="sign-in" />, parameters: { path: '/sign-in' } };
export const Register: StoryObj = { render: () => <SignInScreen mode="register" />, parameters: { path: '/register?invite=ab12cd34' } };
export const InvitesNone: StoryObj = { render: () => <InvitesScreen />, parameters: { world: player, path: '/invites' } };
export const InvitesWithSome: StoryObj = {
  render: () => <InvitesScreen />,
  parameters: { path: '/invites', world: ((fake) => { player(fake); void fake.createInvite(); }) satisfies World },
};
export const Settings: StoryObj = { render: () => <SettingsScreen />, parameters: { world: player, path: '/settings' } };
