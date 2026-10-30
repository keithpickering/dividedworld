/**
 * Stick Around's full-screen view, drawn first as a story for the owner (cards plan, Task 4 as amended 2026-10-30; glass
 * plan, board 08's amended entry): no board draws it, so it is looked at here before its tests or its manifest are
 * written. Board 08 (docs/research/2026-10-29-two-worlds/08-hold.html, 1440 by 980) stays the reference for the frame, the
 * tag, the release in the caster's words and the bar's look.
 *
 * Every story is Thwompson's view of #44 on the boards fixture's `08-hold` moment: Thwompson owns none of the thread's
 * characters, so the card holds them. The post is drawn by the thread's own article, with the real effect in it, as the
 * React board's story draws one post (engine/ui/reactions/Picker.board.stories.tsx); `HoldStage` holds one state still
 * (the thread with the post held, the view with its bar at 40%, the view with a long post scrolled midway) where the page
 * itself would move on.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { createPlays, effectCards, readPlays } from '../../../../engine/ui/cards/plays.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { PostbitPerson } from '../../../../engine/ui/postbit/Postbit.tsx';
import { createMine } from '../../../../engine/ui/reactions/mine.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { seqOfHash } from '../../../../engine/ui/thread/pages.ts';
import { ActArticle, ThreadCtx, type ThreadContext } from '../../../../engine/ui/thread/Post.tsx';
import { createTallies } from '../../../../engine/ui/thread/tallies.ts';
import { HoldStage, type HoldStageValue } from './Effect.tsx';

/** A changelog long enough that the view has to scroll it: the real one, many times over, as Spritey would post it. */
const LONG_CHANGELOG = [
  '[b]Level editor 2.3: the full changelog (again, again, again)[/b]',
  ...Array.from({ length: 9 }, (_, i) => [
    `[b]Part ${i + 1}[/b]`,
    'Pipes can now face any of four directions. Diagonal pipes were tried and are not coming back.',
    'Undo goes back 200 steps instead of 20.\nThe tile picker remembers your last three tilesets.\nWater no longer flows uphill when the level is resized.\nCustom music loops at the point you set, not at the start of the file.\nFixed the crash when an enemy was placed inside another enemy.\nFixed a second, different crash when that happened in water.',
  ].join('\n\n')),
  'Every one of these was requested in this forum. You\'re welcome. Please read it this time.',
].join('\n\n');

interface Read { readonly context: ThreadContext; readonly act: Act; readonly person: PostbitPerson | undefined }

/** The post the moment's address names, read and drawn as the thread does, with its card plays read as the thread reads them. */
function HeldPost({ stage, long = false }: { readonly stage: HoldStageValue; readonly long?: boolean }) {
  const { api, settings, ui } = useKayfa();
  const loc = useLocation();
  const thread = /^\/t\/([^/]+)$/u.exec(loc.path)?.[1] ?? null;
  const seq = seqOfHash(loc.hash);
  const tallies = useMemo(() => createTallies(), []);
  const mine = useMemo(() => createMine(), []);
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    void (async () => {
      if (thread === null || seq === null) return;
      const [summary, [found]] = await Promise.all([api.thread(thread), api.acts(thread, seq, seq)]);
      if (!summary || !found) return;
      const act: Act = long ? { ...found, currentPayload: { ...found.currentPayload, body: LONG_CHANGELOG } } : found;
      const author = act.character;
      let person: PostbitPerson | undefined;
      if (author !== null) {
        const [[character], stats, standings] = await Promise.all([api.characters([author]), api.characterStats([author]), api.standingAmounts([author])]);
        if (character) person = { character, posts: stats[author]?.posts ?? 0, standing: standings[author] ?? null, revealed: null, turnedAt: null };
      }
      tallies.merge(act.id, (await api.tallies([act.id]))[act.id] ?? {});
      mine.merge(act.id, await api.myReactions([act.id]));
      const plays = createPlays();
      await readPlays(api, plays, [act.id], effectCards(ui));
      setRead({
        act, person,
        context: { thread, perPage: settings.postsPerPage, summary, tallies, mine, plays, nameOf: () => 'Gloomba', observer: null, quote: null, changed: () => {} },
      });
    })();
  }, [api, settings, ui, thread, seq, tallies, mine, long]);
  if (!read) return <div aria-busy="true" />;
  return (
    <div style={{ minHeight: '100vh', boxSizing: 'border-box', padding: stage.mode === 'live' ? '55vh 32px 150vh' : '24px 32px', background: 'var(--kb-bg)', color: 'var(--kb-fg)' }}>
      <HoldStage.Provider value={stage}>
        <ThreadCtx.Provider value={read.context}>
          <ActArticle act={read.act} person={read.person} layout="side" slid={false} />
        </ThreadCtx.Provider>
      </HoldStage.Provider>
    </div>
  );
}

const meta: Meta<typeof HeldPost> = {
  title: 'Boards/08 Hold',
  component: HeldPost,
  parameters: { moment: '08-hold', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof HeldPost>;

/** The post held in its thread: the game's frame and the card's tag on the post, before it takes the reader over. */
export const HeldInThread: Story = { args: { stage: { mode: 'thread' } } };

/** The full-screen view at board 08's size (1440 by 980), the bar at 40%, the caster's checkbox at the end of the short post. */
export const View: Story = { args: { stage: { mode: 'view', level: 0.4 } } };

/** A long post, read midway in the view: it scrolls inside, and the release stands at its end, out of sight until it is read to. */
export const LongPostScrolled: Story = { args: { stage: { mode: 'view', level: 0.4, scrolled: 0.5 }, long: true } };

/** The view on the Phone board's 390 by 844. */
export const Phone: Story = {
  args: { stage: { mode: 'view', level: 0.4 } },
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};

/** The page itself, on a longer page: the post pulls the reader in when they stop with it in view, and a push past its end fills the bar. Try it. */
export const Live: Story = { args: { stage: { mode: 'live' } } };

/** The page itself with a long post, which the view has to scroll to its end before a push past it counts (e2e/hold.spec.ts reads it so). */
export const LiveLongPost: Story = { args: { stage: { mode: 'live' }, long: true } };
