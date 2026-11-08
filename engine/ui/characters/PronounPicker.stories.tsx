import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PRONOUN_PRESETS, type PronounSet } from '../../rules/pronouns.ts';
import { PronounPicker } from './PronounPicker.tsx';

function Picker({ start, name }: { readonly start: PronounSet; readonly name: string }) {
  const [value, setValue] = useState(start);
  return <PronounPicker name={name} value={value} onChange={setValue} />;
}

const meta: Meta<typeof Picker> = { title: 'Characters/Pronoun picker', component: Picker, parameters: { path: '/characters/new' } };
export default meta;

type Story = StoryObj<typeof Picker>;

export const Preset: Story = { args: { start: PRONOUN_PRESETS.she, name: 'Gloomba' } };
export const Custom: Story = { args: { start: { subject: 'xe', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: false }, name: 'Gloomba' } };
export const CustomWithProblem: Story = { args: { start: { subject: 'abcdefghijklm', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: true }, name: '' } };
