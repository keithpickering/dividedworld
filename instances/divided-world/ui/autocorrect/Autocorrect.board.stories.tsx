/**
 * Autocorrect's masking tape as stories for the owner's word (docs/plans/2026-11-11-autocorrect-tape-design.md; plan Task 10): the
 * bench's five posts (docs/research/2026-11-11-autocorrect-tape-bench/01-bench.html) written for the Main board's moment, each with
 * the plays the bench gives it: `one` (a short word, three times), `covered` (the words wider than the replacement), `wider` (the
 * replacement wider than the words), `across` (a long phrase that breaks across lines at a phone's width) and `stack` (three strips
 * pressed one over another). `half` is `one` with the first strip half peeled by its author, saved as a `stuck` stretch, so the
 * residue and a tape end stand on screen; `reloaded` is `wider` visited again after its author peeled the strip whole (saved as `peeled`),
 * which takes its words' own width with no room after them.
 *
 * `viewer` is `reader`, a new account that wrote none of the thread (it can only peek, and nothing it does is saved), or `author`,
 * the moment's own player, who wrote the post and may peel for good. The plays come from #42's author, who is not the post's. Each
 * case has a Light, a Dark, an Author (light) and a Phone twin at 390 by 844 (the others at 1440 by 1120); `Still*` is reduced motion
 * (the peel is instant; the strip still lifts and the tape still comes off). Peel with a drag, or focus a strip's anchor and hold
 * Enter or Space. (The story lives under ui/, where Storybook looks; the card's screens are in cards/autocorrect/.)
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

type Case = 'one' | 'covered' | 'wider' | 'across' | 'stack' | 'half' | 'reloaded';
type Viewer = 'reader' | 'author';

interface Args {
  readonly shown: Case;
  readonly viewer: Viewer;
  readonly mode: 'light' | 'dark';
  readonly reduced: boolean;
}

const BODY: Record<Case, string> = {
  one: 'Finally beat the last castle in my Mario fangame. Mario controls a lot better than he did in the demo, and the new Mario sprites are all by Sloopy.',
  covered: 'Honestly the Mushroom Kingdom tileset is the best thing in this release. I would put the Mushroom Kingdom tileset in every game I make if I could.',
  wider: 'My review, for what it is worth: the boss fight is fine. Music slaps though.',
  across: 'Look, I have been on this forum since the Klik days and I will say it plainly: I have never once played a fangame I did not secretly enjoy, and I am not about to start with this one.',
  stack: 'Big cats are the best enemies in the whole game, and I cheer every time big cats are back for another level.',
  half: 'Finally beat the last castle in my Mario fangame. Mario controls a lot better than he did in the demo, and the new Mario sprites are all by Sloopy.',
  reloaded: 'My review, for what it is worth: the boss fight is fine. Music slaps though.',
};
const MARIO = [{ phrase: 'Mario', replacement: 'Luigi' }];
const PLAYS: Record<Case, readonly { phrase: string; replacement: string }[]> = {
  one: MARIO,
  covered: [{ phrase: 'the Mushroom Kingdom tileset', replacement: 'Ohio' }],
  wider: [{ phrase: 'the boss fight is fine', replacement: 'the boss fight is the single greatest achievement in the history of fangames' }],
  across: [{ phrase: 'I have never once played a fangame I did not secretly enjoy', replacement: 'I am legally required to be nice about fangames' }],
  stack: [{ phrase: 'big cats', replacement: 'small dogs' }, { phrase: 'cats are', replacement: 'nobody asked' }, { phrase: 'big cats', replacement: 'Wigglers' }],
  half: MARIO,
  reloaded: [{ phrase: 'the boss fight is fine', replacement: 'the boss fight is the single greatest achievement in the history of fangames' }],
};
/** The first Mario's strip half peeled: its first 45% gone, ending at a peel line (a Stretch is [from, to, edges], edges = startKind * 3 + endKind; 0 an end of the strip, 1 a peel line, 2 a tear). */
const HALF = { peeled: [] as number[], stuck: { '0': [[0, 0.45, 1]] } };

/** The saved states a case opens with, as its author saved them: the first strip of `half` half peeled, and of `reloaded` (the `wider` post, visited again) peeled whole, so it takes its words' own width and leaves its residue there. */
const SAVED: Partial<Record<Case, { readonly peeled: number[]; readonly stuck?: Record<string, number[][]> }>> = { half: HALF, reloaded: { peeled: [0] } };

function Autocorrected({ shown, viewer, mode, reduced }: Args) {
  const { api, instance } = useKayfa();
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
      const post = fake.seed.post(thread, author.character, BODY[shown]);
      const plays = PLAYS[shown].map((config, i) => fake.seed.card(caster.character!, post, 'autocorrect', { layer: i + 1, live: true, config, message: '' }));
      /* The author's own save, made before a reader is signed in. */
      const state = SAVED[shown];
      if (state) {
        const saved = await api.saveEffect(plays[0]!, author.character, state);
        if (!saved.ok) throw new Error(`the saved peel was refused: ${saved.error}`);
      }
      if (viewer === 'reader') {
        const account = fake.seed.account('story-reader');
        fake.seed.character(account, 'Story reader', instance.classes[0]!.key);
        fake.signInAs(account);
      }
      if (live) setSeeded(thread);
    })().catch((e: unknown) => { console.error('the Autocorrect story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, shown, viewer]);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Autocorrected> = {
  title: 'Boards/11 Autocorrect',
  component: Autocorrected,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { shown: 'one', viewer: 'reader', mode: 'light', reduced: false },
};
export default meta;

type Story = StoryObj<typeof Autocorrected>;
const phone = { parameters: { moment: '02-phone' } } as const;
export const OneLight: Story = { args: { shown: 'one', viewer: 'reader', mode: 'light' } };
export const OneDark: Story = { args: { shown: 'one', viewer: 'reader', mode: 'dark' } };
export const OneAuthor: Story = { args: { shown: 'one', viewer: 'author', mode: 'light' } };
export const OnePhone: Story = { args: { shown: 'one', viewer: 'reader', mode: 'light' }, ...phone };
export const OnePhoneDark: Story = { args: { shown: 'one', viewer: 'author', mode: 'dark' }, ...phone };

export const CoveredLight: Story = { args: { shown: 'covered', viewer: 'reader', mode: 'light' } };
export const CoveredDark: Story = { args: { shown: 'covered', viewer: 'reader', mode: 'dark' } };
export const CoveredAuthor: Story = { args: { shown: 'covered', viewer: 'author', mode: 'light' } };
export const CoveredPhone: Story = { args: { shown: 'covered', viewer: 'reader', mode: 'light' }, ...phone };
export const CoveredPhoneDark: Story = { args: { shown: 'covered', viewer: 'author', mode: 'dark' }, ...phone };

export const WiderLight: Story = { args: { shown: 'wider', viewer: 'reader', mode: 'light' } };
export const WiderDark: Story = { args: { shown: 'wider', viewer: 'reader', mode: 'dark' } };
export const WiderAuthor: Story = { args: { shown: 'wider', viewer: 'author', mode: 'light' } };
export const WiderPhone: Story = { args: { shown: 'wider', viewer: 'reader', mode: 'light' }, ...phone };
export const WiderPhoneDark: Story = { args: { shown: 'wider', viewer: 'author', mode: 'dark' }, ...phone };

export const AcrossLight: Story = { args: { shown: 'across', viewer: 'reader', mode: 'light' } };
export const AcrossDark: Story = { args: { shown: 'across', viewer: 'reader', mode: 'dark' } };
export const AcrossAuthor: Story = { args: { shown: 'across', viewer: 'author', mode: 'light' } };
export const AcrossPhone: Story = { args: { shown: 'across', viewer: 'reader', mode: 'light' }, ...phone };
export const AcrossPhoneDark: Story = { args: { shown: 'across', viewer: 'author', mode: 'dark' }, ...phone };

export const StackLight: Story = { args: { shown: 'stack', viewer: 'reader', mode: 'light' } };
export const StackDark: Story = { args: { shown: 'stack', viewer: 'reader', mode: 'dark' } };
export const StackAuthor: Story = { args: { shown: 'stack', viewer: 'author', mode: 'light' } };
export const StackPhone: Story = { args: { shown: 'stack', viewer: 'reader', mode: 'light' }, ...phone };
export const StackPhoneDark: Story = { args: { shown: 'stack', viewer: 'author', mode: 'dark' }, ...phone };

export const HalfLight: Story = { args: { shown: 'half', viewer: 'reader', mode: 'light' } };
export const HalfDark: Story = { args: { shown: 'half', viewer: 'reader', mode: 'dark' } };
export const HalfAuthor: Story = { args: { shown: 'half', viewer: 'author', mode: 'light' } };
export const HalfPhone: Story = { args: { shown: 'half', viewer: 'reader', mode: 'light' }, ...phone };
export const HalfPhoneDark: Story = { args: { shown: 'half', viewer: 'author', mode: 'dark' }, ...phone };

export const ReloadedLight: Story = { args: { shown: 'reloaded', viewer: 'reader', mode: 'light' } };
export const ReloadedDark: Story = { args: { shown: 'reloaded', viewer: 'reader', mode: 'dark' } };
export const ReloadedPhone: Story = { args: { shown: 'reloaded', viewer: 'reader', mode: 'light' }, ...phone };
export const StillLight: Story = { args: { shown: 'one', viewer: 'author', reduced: true } };
export const StillPhone: Story = { args: { shown: 'stack', viewer: 'reader', reduced: true }, ...phone };
