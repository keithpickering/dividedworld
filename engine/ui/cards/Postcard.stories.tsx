/**
 * The postcard's frame at its four sizes (docs/plans/2026-11-05-card-template-design.md): the instance's cards drawn at each size,
 * and the card's back, default and the hit pull's gold, wearing the instance's mark where it gave one (`InstanceUi.cardBack`).
 * Nothing here acts.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import { facesOf } from './faces.ts';
import { Postcard, PostcardBack } from './Postcard.tsx';
import { SIZES, type PostcardSize } from './template.ts';

const sizes = Object.keys(SIZES) as PostcardSize[];
const row = { display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', padding: 24 } as const;

function Faces() {
  const { instance, ui } = useKayfa();
  const faces = useMemo(() => facesOf(instance.cards, ui.cards, instance.settings, ui.copy.cardKinds), [instance, ui.cards, ui.copy.cardKinds]);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {faces.map((face) => (
        <div key={face.key} style={row}>
          {sizes.map((size) => <Postcard key={size} as="span" face={face} size={size} role="img" aria-label={`${face.name}, ${size}`} />)}
        </div>
      ))}
    </div>
  );
}

function Backs() {
  const { ui } = useKayfa();
  return (
    <div style={row}>
      <p style={{ flexBasis: '100%', margin: 0 }}>The card back at the four sizes. A back names no card, and every card has the same one.</p>
      {sizes.map((size) => <PostcardBack key={size} size={size} {...(ui.cardBack ?? {})} role="img" aria-label={`A face-down postcard, ${size}`} />)}
    </div>
  );
}

const meta: Meta<typeof Faces> = {
  title: 'Cards/Postcard',
  /* A path, so the preview gives the story its router and the instance. */
  parameters: { path: '/' },
};
export default meta;

export const AllSizes: StoryObj<typeof Faces> = { render: () => <Faces /> };
export const CardBacks: StoryObj<typeof Faces> = { render: () => <Backs /> };
