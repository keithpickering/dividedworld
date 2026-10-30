import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Character } from '../data/api.ts';
import { Postbit, type PostbitPerson } from './Postbit.tsx';

const meta: Meta<typeof Postbit> = {
  title: 'Postbit/Postbit',
  component: Postbit,
  parameters: { world: () => {} },
};
export default meta;

type Story = StoryObj<typeof Postbit>;

/* Plain pictures drawn here, so a story needs no file: a tall one and a square one. */
const picture = (w: number, h: number) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/><circle cx="${w / 2}" cy="${h / 4}" r="${w / 4}"/></svg>`;

const character = (over: Partial<Character> = {}): Character => ({
  id: 'story-character', name: 'Pipewrench', title: 'Professional Wrench', signature: '', avatarSquare: picture(100, 100), avatarPortrait: picture(100, 200),
  squareFrame: null, portraitFrame: null, pipStyle: 'default', joined: '2026-10-01', ...over,
});
const person = (over: Partial<PostbitPerson> = {}, c: Partial<Character> = {}): PostbitPerson => ({
  character: character(c), posts: 212, standing: 650, revealed: null, turnedAt: null, ...over,
});

export const SideBySide: Story = { args: { person: person(), layout: 'side' } };
export const Stacked: Story = { args: { person: person(), layout: 'stacked' } };
export const SquareInTheTallSlot: Story = { args: { person: person({}, { avatarPortrait: null }), layout: 'side' } };
export const NoAvatar: Story = { args: { person: person({}, { avatarSquare: null, avatarPortrait: null }), layout: 'side' } };
export const ClassRevealed: Story = { args: { person: person({ revealed: { class: 'heel', at: '2026-10-03T12:00:00Z' } }), layout: 'side' } };
export const ClassRevealedThenTurned: Story = {
  args: { person: person({ revealed: { class: 'heel', at: '2026-10-03T12:00:00Z' }, turnedAt: '2026-10-20T12:00:00Z' }), layout: 'stacked' },
};
