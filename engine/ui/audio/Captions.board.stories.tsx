/**
 * The caption bar (the Laugh Track plan, Task 3), drawn for the owner against the bench's look A
 * (`docs/research/2026-11-11-laugh-track-bench/01-bench.html`): a short caption, a long one, and a held one (a loop's build-up, italic), each on the
 * Main board and, at 390 wide, the Phone one. The bar stands above the HUD's seam (the page's own), and these stories hold their caption for as
 * long as they are open rather than for a sound's length.
 */
import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import { playerWorld } from '../story.tsx';
import { Captions } from './Captions.tsx';
import { createCaptions, type CaptionWords } from './captions.ts';

const FOREVER = 3_600_000;

/* Each story makes its own store, so one story's caption never reaches another's. */
function Bar({ words, held }: { readonly words: CaptionWords; readonly held?: boolean }) {
  const [store] = useState(createCaptions);
  useEffect(() => {
    if (held) store.hold('story', words);
    else store.say({ ...words, ms: FOREVER });
    return () => { if (held) store.release('story'); };
  }, [store, words, held]);
  return <Captions store={store} />;
}

function Story({ words, held }: { readonly words: CaptionWords; readonly held?: boolean }) {
  return (
    <Page surface="settings">
      <p>The caption bar stands above the HUD's seam, centered, and lets every press through.</p>
      <Bar words={words} held={held} />
    </Page>
  );
}

const SHORT: CaptionWords = { text: 'Crowd laughs', ink: 'var(--kb-glass-salty)' };
const LONG: CaptionWords = { text: 'Studio audience laughs, then groans, then a single slow clap from the back of the room that nobody asked for', ink: 'var(--kb-glass-sweet)' };
const BUILD: CaptionWords = { text: 'Crowd murmuring, building', ink: 'var(--kb-glass-ready)' };

const meta: Meta<typeof Story> = {
  title: 'Boards/Captions',
  component: Story,
  parameters: { world: playerWorld, path: '/settings', layout: 'fullscreen' },
};
export default meta;

type Story_ = StoryObj<typeof Story>;
const phone = { viewport: { value: 'glassPhone390', isRotated: false } };

/** A short caption on the Main board. */
export const ShortMain: Story_ = { name: 'Short caption, main', args: { words: SHORT } };
/** A short caption on the Phone board. */
export const ShortPhone: Story_ = { name: 'Short caption, phone 390', args: { words: SHORT }, globals: phone };
/** A long caption on the Main board. */
export const LongMain: Story_ = { name: 'Long caption, main', args: { words: LONG } };
/** A long caption at a phone's width: it wraps inside the gutters. */
export const LongPhone: Story_ = { name: 'Long caption, phone 390', args: { words: LONG }, globals: phone };
/** A held caption (a loop's build-up), italic, on the Main board. */
export const HeldMain: Story_ = { name: 'Held caption, main', args: { words: BUILD, held: true } };
/** A held caption on the Phone board. */
export const HeldPhone: Story_ = { name: 'Held caption, phone 390', args: { words: BUILD, held: true }, globals: phone };
