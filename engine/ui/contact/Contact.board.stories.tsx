/**
 * Reach a person, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/16-contact.html` (1440 wide) and
 * `18-door-phone.html` (390 by 844): the screen itself (`ContactScreen`) in the glass's page shell, as the route /contact puts it
 * (web/src/App.tsx), signed out, with the board's two ways: a Discord link and an email address (made up here).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { ContactScreen } from './Contact.tsx';

/** No one signed in, and the admins' two ways set. */
const ways: World = (fake) => {
  fake.seed.contact([
    { label: 'Discord', href: 'https://discord.example/users/admin' },
    { label: 'Email', href: 'mailto:admin@example.test' },
  ]);
};

function ContactStory() {
  return <Page surface="settings"><ContactScreen /></Page>;
}

const meta: Meta<typeof ContactStory> = {
  title: 'Boards/00 Reach a person',
  component: ContactStory,
  parameters: { world: ways, path: '/contact', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof ContactStory>;

/** Reach a person on the Main board's layout, at 1440 wide. */
export const Contact: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const ContactPhone: Story = {
  name: 'Reach a person, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
