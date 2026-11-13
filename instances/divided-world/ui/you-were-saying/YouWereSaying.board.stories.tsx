/**
 * You Were Saying? as stories for the owner's word (docs/plans/2026-11-07-you-were-saying-plan.md, Task 8): a post of the boards fixture's Main
 * board moment, written for the stories, with the old voice's tail after it: one tail, three chained (each play's words its own span of
 * the one run), and a chain whose last play is still writing (the cursor typing nothing). Each on the light board and the dark board, and under reduced motion (the words at once, the cursor still). The
 * plays come from #42's author, who is not the post's. Hold the mouse on the tail, or focus it and hold Backspace, to erase it from the end;
 * let go and it types itself back in. Open them at 1440 by 1120 and at 390 by 844. (The story lives under ui/, where Storybook looks; the
 * card's screens are in cards/you-were-saying/.)
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

type Case = 'one' | 'chain' | 'waiting' | 'tapedFirst' | 'tapedLast';

interface Args {
  readonly shown: Case;
  readonly mode: 'light' | 'dark';
  readonly reduced: boolean;
}

/* The taped cases (docs/plans/2026-11-12-tail-innermost-plan.md, Task 1): words that wrap to three lines or more at the board's width, and a phrase Autocorrect covers once, well away from the last line. */
const TAPED_BODY = 'Honestly the Mushroom Kingdom tileset is the best thing in this release, and I would put that tileset in every game I make if I could. The music is also very good, the level design is better than anyone had a right to expect from a demo, and the secret exits are hidden just well enough that nobody will ever find all of them, which is exactly how it should be.';
const TAPED_PHRASE = { phrase: 'the Mushroom Kingdom tileset', replacement: 'Ohio' };
const BODY = 'The best thing about the Mushroom Kingdom is that nobody there ever has to';
/* Each play's words, as the old voice would run on: the first starts where the author stopped, the next where the one before stopped. */
const TAILS: Record<Case, readonly (string | null)[]> = {
  one: [' worry about taxes, because the coins grow on bricks and the bricks are free.'],
  chain: [' worry about taxes, because the coins grow on bricks', ' and the bricks are free. The princess has been saying so for years', ', and the plumbers agree with her, mostly.'],
  waiting: [' worry about taxes, because the coins grow on bricks and the bricks are free.', null],
  tapedFirst: [' And the princess agrees, mostly.'],
  tapedLast: [' And the princess agrees, mostly.'],
};
/* Which card is played first (the lower layer): in tapedFirst Autocorrect, in tapedLast You Were Saying?. */
const TAPED_LAYERS = { tapedFirst: { ac: 1, yws: 2 }, tapedLast: { ac: 2, yws: 1 } } as const;

function Tailed({ shown, mode, reduced }: Args) {
  const { api } = useKayfa();
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  /* The thread is drawn once the plays are seeded: its page is read once, so a play seeded after the read and before the page listens is never drawn. */
  const [seeded, setSeeded] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    root.setAttribute('data-kb-motion', reduced ? 'reduce' : 'full');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [mode, reduced]);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[author], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!author?.character || !caster?.character) return;
      const fake = api as Fake;
      const taped = shown === 'tapedFirst' || shown === 'tapedLast' ? TAPED_LAYERS[shown] : null;
      const post = fake.seed.post(thread, author.character, taped ? TAPED_BODY : BODY);
      if (taped) fake.seed.card(caster.character!, post, 'autocorrect', { layer: taped.ac, live: true, config: TAPED_PHRASE, message: '' });
      TAILS[shown].forEach((words, i) => {
        const play = fake.seed.card(caster.character!, post, 'you-were-saying', { layer: taped ? taped.yws : i + 1, live: true, config: { steps: 0 }, message: '' });
        if (words !== null) fake.seed.text(play, post, { text: words }, { quiet: true });
      });
      if (live) setSeeded(thread);
    })();
    return () => { live = false; };
  }, [api, thread, shown]);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Tailed> = {
  title: 'Boards/20 You Were Saying',
  component: Tailed,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { shown: 'one', mode: 'light', reduced: false },
};
export default meta;

type Story = StoryObj<typeof Tailed>;

export const OneLight: Story = { args: { shown: 'one', mode: 'light' } };
export const OneDark: Story = { args: { shown: 'one', mode: 'dark' } };
export const ChainLight: Story = { args: { shown: 'chain', mode: 'light' } };
export const ChainDark: Story = { args: { shown: 'chain', mode: 'dark' } };
export const WaitingLight: Story = { args: { shown: 'waiting', mode: 'light' } };
export const StillLight: Story = { args: { shown: 'chain', reduced: true } };
/* Autocorrect and You Were Saying? on one post, in each order of play, under reduced motion: the tail stands next to the words either way. */
export const TapedFirst: Story = { args: { shown: 'tapedFirst', reduced: true } };
export const TapedLast: Story = { args: { shown: 'tapedLast', reduced: true } };
