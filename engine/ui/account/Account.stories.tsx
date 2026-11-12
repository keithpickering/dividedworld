import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Fake } from '../data/fake.ts';
import type { World } from '../story.tsx';
import { LoadedSettings } from '../loaded.tsx';
import { SignInScreen } from './SignIn.tsx';
import { AccountGate } from './OpenAccount.tsx';

const meta: Meta = { title: 'Account' };
export default meta;

const player = ((fake: Fake) => {
  const me = fake.seed.account('story-player');
  fake.signInAs(me);
}) satisfies World;

export const SignIn: StoryObj = { render: () => <SignInScreen mode="sign-in" />, parameters: { path: '/sign-in' } };
export const Register: StoryObj = { render: () => <SignInScreen mode="register" />, parameters: { path: '/register?invite=ab12cd34' } };
export const Settings: StoryObj = { render: () => <LoadedSettings />, parameters: { world: player, path: '/settings' } };
export const SettingsAccount: StoryObj = { render: () => <LoadedSettings />, parameters: { world: player, path: '/settings?section=account' } };
export const SettingsAccountWithInvites: StoryObj = {
  render: () => <LoadedSettings />,
  parameters: { path: '/settings?section=account', world: ((fake) => { player(fake); void fake.createInvite(); }) satisfies World },
};

/* What a barred account sees in place of every page, and what an account that has not accepted the code sees (the conduct plan, Task 4). */
const barred = (until: number | null) => ((fake: Fake) => {
  const me = fake.seed.account('story-barred');
  fake.seed.bar(me, until);
  fake.signInAs(me);
}) satisfies World;
export const BarredSuspended: StoryObj = { render: () => <AccountGate><p>The page</p></AccountGate>, parameters: { world: barred(Date.parse('2099-01-15T00:00:00Z')), path: '/' } };
export const BarredBanned: StoryObj = { render: () => <AccountGate><p>The page</p></AccountGate>, parameters: { world: barred(null), path: '/' } };
export const AcceptTheCode: StoryObj = {
  render: () => <AccountGate><p>The page</p></AccountGate>,
  parameters: { path: '/', world: ((fake) => { const me = fake.seed.account('story-new'); fake.seed.unaccepted(me); fake.signInAs(me); }) satisfies World },
};
