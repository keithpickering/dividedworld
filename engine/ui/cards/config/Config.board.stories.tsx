/**
 * The play form's pieces for a card's settings (docs/plans/2026-11-12-laugh-track-band-plan.md, Task 7), the five of them together on the play
 * form's own surface at 420 pixels, for the owner's word: the post's words to select from, a cue's labeled field with its Remove, hint and
 * refusal, the segmented choice, the range, and a live hint. `Pieces` is the form as a card draws it; `Smoke` selects words in the post (the field fills), types, chooses
 * and moves the range, so a regression in any piece shows in the story and not only in a test.
 *
 * The story names no card and no instance: the words and the labels are made up for it.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { expect, fireEvent, userEvent, within } from 'storybook/test';
import { GlassButton } from '../../glass/Button.tsx';
import { Smoke as Clouds } from '../../glass/Smoke.tsx';
import { playerWorld } from '../../story.tsx';
import '../play.css';
import { ConfigChoice } from './ConfigChoice.tsx';
import { ConfigField } from './ConfigField.tsx';
import { ConfigHint } from './ConfigHint.tsx';
import { ConfigRange } from './ConfigRange.tsx';
import { PostWords } from './PostWords.tsx';

const WORDS = 'I made a fan game about forums years ago, and the forums are why anyone played it. Mario would have laughed.';
type Sound = 'laugh' | 'cheer' | 'boo';
const SOUNDS = [{ value: 'laugh', label: 'Laugh' }, { value: 'cheer', label: 'Cheer' }, { value: 'boo', label: 'Boo' }] as const;

function Pieces() {
  const form = useRef<HTMLFieldSetElement>(null);
  const [phrase, setPhrase] = useState('');
  const [sound, setSound] = useState<Sound>('laugh');
  const [count, setCount] = useState(4);
  const [spilled, setSpilled] = useState(false);
  const short = phrase.trim() !== '' && phrase.trim().length < 4;
  return (
    <div className="kb-glass kb-play" style={{ width: 420, boxSizing: 'border-box', padding: 16, position: 'relative' }}>
      <Clouds surface="play" />
      <fieldset ref={form} className="kb-play-config-group">
        <legend className="kb-visually-hidden">Your audience&apos;s cues</legend>
        <div>
          <p className="kb-play-label">The post</p>
          <ConfigHint live>{spilled ? 'Your selection went past the post\'s words, so nothing was taken.' : 'Select words below, or type them.'}</ConfigHint>
          <PostWords words={WORDS} within={form} onSpill={setSpilled} onSelect={(t) => { setSpilled(false); setPhrase(t.trim()); }} />
        </div>
        <ConfigField
          id="story-cue"
          label="Cue 1"
          value={phrase}
          maxLength={40}
          onChange={setPhrase}
          hint="At least 4 letters or digits, matched as whole words in any case."
          why={short ? 'That phrase is too short.' : undefined}
          action={<GlassButton kind="quiet" size="s" onClick={() => setPhrase('')}>Remove</GlassButton>}
        />
        <ConfigChoice name="story-sound" label="Sound for cue 1" hideLegend options={SOUNDS} value={sound} onChoose={setSound} />
        <ConfigRange id="story-range" label="How many" min={1} max={10} value={count} valueText={`${count} posts, ${count * 10} orbs`} onChange={setCount} />
        <ConfigHint live>{count} posts, {count * 10} orbs</ConfigHint>
      </fieldset>
    </div>
  );
}

const meta: Meta<typeof Pieces> = {
  title: 'Boards/02 Card settings pieces',
  component: Pieces,
  parameters: { world: playerWorld, layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Pieces>;

/** The five pieces at 420 pixels. */
export const Form: Story = {};

/** Selecting words in the post, typing, choosing and moving the range, each in its own control. */
export const Smoke: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const post = canvasElement.querySelector('[data-kb-post-words]')!;
    const picked = document.createRange();
    picked.setStart(post.firstChild!, 9);
    picked.setEnd(post.firstChild!, 17);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(picked);
    document.dispatchEvent(new Event('selectionchange'));
    await expect(await c.findByLabelText('Cue 1')).toHaveValue('fan game');
    await userEvent.clear(c.getByLabelText('Cue 1'));
    await userEvent.type(await c.findByLabelText('Cue 1'), 'ab');
    await expect(await c.findByText('That phrase is too short.')).toBeInTheDocument();
    /* The radio itself: a click on its label is re-sent to it by user-event, with a view jsdom refuses, which the unit sweep runs this play in. */
    await userEvent.click(c.getByRole('radio', { name: 'Boo' }));
    await expect(c.getByRole('radio', { name: 'Boo' })).toBeChecked();
    const range = c.getByLabelText('How many');
    /* The change a key's step fires: a browser steps a range on an arrow key, jsdom (which runs this play in the unit sweep) does not. */
    fireEvent.change(range, { target: { value: '5' } });
    await expect(range).toHaveAttribute('aria-valuetext', '5 posts, 50 orbs');
  },
};
