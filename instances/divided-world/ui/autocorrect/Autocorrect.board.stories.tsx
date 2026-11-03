/**
 * Autocorrect as stories for the owner's word (docs/plans/2026-11-03-autocorrect-plan.md, Task 8): a post of the boards fixture's
 * Main board moment, written for the stories, with one Autocorrect, three stacked with an overlap, a phrase across bold, and a long
 * strip that breaks across lines, on the light board and the dark board, and under reduced motion (a peel fades in place). The plays
 * come from #42's author, who is not the post's. Peel a strip by dragging it off, or focus it and hold Enter or Space. Open them at
 * 1440 by 1120 and at 390 by 844. (The story lives under ui/, where Storybook looks; the card's screens are in cards/autocorrect/.)
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { ThreadScreen } from '../../../../engine/ui/thread/Thread.tsx';

type Case = 'one' | 'stack' | 'bold' | 'long';

interface Args {
  readonly shown: Case;
  readonly mode: 'light' | 'dark';
  readonly reduced: boolean;
}

const BODY: Record<Case, string> = {
  one: 'Mario is the best plumber in the Mushroom Kingdom, and anyone who says otherwise has never seen Mario jump.',
  stack: 'The big cats at the zoo are the best cats. I love cats, and big cats most of all.',
  bold: 'Our next guest is [b]Mar[/b]io, who needs no introduction. Give it up for Mario!',
  long: 'I have to say that the Super Mario Bros. Super Show was the finest television program of its decade, no contest.',
};
const PLAYS: Record<Case, readonly { phrase: string; replacement: string }[]> = {
  one: [{ phrase: 'Mario', replacement: 'Luigi' }],
  stack: [{ phrase: 'big cats', replacement: 'tiny dogs' }, { phrase: 'cats', replacement: 'kittens' }, { phrase: 'zoo', replacement: 'DMV' }],
  bold: [{ phrase: 'Mario', replacement: 'Wario' }],
  long: [{ phrase: 'Super Mario Bros. Super Show', replacement: 'Legend of Zelda animated series, the one with the catchphrase' }],
};

function Autocorrected({ shown, mode, reduced }: Args) {
  const { api } = useKayfa();
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    root.setAttribute('data-kb-motion', reduced ? 'reduce' : 'full');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [mode, reduced]);
  useEffect(() => {
    if (thread === null) return;
    void (async () => {
      const [[author], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!author?.character || !caster?.character) return;
      const fake = api as Fake;
      const post = fake.seed.post(thread, author.character, BODY[shown]);
      PLAYS[shown].forEach((config, i) => fake.seed.card(caster.character!, post, 'autocorrect', { layer: i + 1, live: true, config, message: '' }));
    })();
  }, [api, thread, shown]);
  return <Frame>{thread ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Autocorrected> = {
  title: 'Boards/11 Autocorrect',
  component: Autocorrected,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { shown: 'one', mode: 'light', reduced: false },
};
export default meta;

type Story = StoryObj<typeof Autocorrected>;

export const OneLight: Story = { args: { shown: 'one', mode: 'light' } };
export const OneDark: Story = { args: { shown: 'one', mode: 'dark' } };
export const StackLight: Story = { args: { shown: 'stack', mode: 'light' } };
export const StackDark: Story = { args: { shown: 'stack', mode: 'dark' } };
export const BoldLight: Story = { args: { shown: 'bold', mode: 'light' } };
export const LongLight: Story = { args: { shown: 'long', mode: 'light' } };
export const LongDark: Story = { args: { shown: 'long', mode: 'dark' } };
export const StillLight: Story = { args: { shown: 'one', reduced: true } };
