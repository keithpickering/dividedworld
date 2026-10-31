/**
 * The marks on a post, quiet, as stories for the owner (docs/plans/2026-10-31-marks-and-the-lens-plan.md, Task 8; the mockup they
 * are set against is docs/research/2026-10-31-marks-and-the-lens/, whose Lens and takeover stories are the instance's:
 * instances/divided-world/ui/whoops/Lens.board.stories.tsx). Post #41 of the boards fixture, read at the Main board's moment, with
 * its marks: `OnePlay` (the fixture's one play, its card met before so no callout hangs), `Callout` (the same for a reader who has
 * never met the card, so its one-line callout hangs off the mark), `SixKinds` (six kinds of card on one post: four marks and
 * "+2"), and `Armed` (Whoops! armed the way pressing its card in the hand arms it: the dashed ghost mark ends the strip of every post it
 * can land on, #41 and #42 among them). No board draws these. Open each at 1440 by 1120, and its `Phone` twin at 390 by 844.
 *
 * The story names no instance: the cards are the instance's own, in its order, and the kinds past them are keys no card has, which a
 * mark draws as a swatch under the key's name, so six kinds are six distinct cards on the post.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { usePlayer } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { usePlay } from './play.tsx';

const MINUTE = 60_000;

type Kinds = 1 | 6;

/** Hand #41 its plays (and, for `quiet`, say every card met), then say the thread is ready to be read. */
function useSeeded(thread: string | null, kinds: Kinds, quiet: boolean): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      if (quiet) for (const c of instance.cards) await api.meetCard(c.key);
      if (kinds > 1) {
        const acts = await api.acts(thread, 41, 46);
        const target = acts.find((a) => a.seq === 41);
        const casters = [45, 44, 43, 42, 45].map((n) => acts.find((a) => a.seq === n)?.character ?? null);
        if (!target || casters.some((c) => c === null)) throw new Error('the boards fixture has no #41, or no author for a post around it');
        /* The fixture's play is one kind; the instance's other cards are the next, then keys no card has. */
        const have = new Set((await api.cardsOn(target.id, 8)).map((a) => String(a.currentPayload.card)));
        const keys = [...instance.cards.map((c) => c.key), ...Array.from({ length: kinds }, (_, i) => `story-kind-${i + 1}`)].filter((k) => !have.has(k)).slice(0, kinds - have.size);
        keys.forEach((card, i) => {
          fake.clock.advance(MINUTE);
          fake.seed.card(casters[i]!, target.id, card, { layer: 2 + i, message: '' });
        });
      }
      if (live) setReady(true);
      /* A seed the fake refuses leaves the story loading (aria-busy), and says why, rather than showing fewer kinds than its name. */
    })().catch((e: unknown) => { console.error('the marks story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, kinds, quiet]);
  return ready;
}

/** Arms the instance's Whoops! (the story names no instance: the card whose name is Whoops!), as the player's press in the hand does. */
function Arm() {
  const { instance } = useKayfa();
  const play = usePlay();
  const key = instance.cards.find((c) => c.name === 'Whoops!')?.key ?? null;
  /* A card is armed for an account and put back when the account changes (play.tsx), so it is armed once the account is known. */
  const account = usePlayer().session.account;
  useEffect(() => {
    if (!play || key === null || account === null) return;
    play.arm(key);
    // Armed once for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, account]);
  return null;
}

/** Scrolls #41 to the middle of the window once the thread has drawn it. */
function Look() {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.getElementById('post-41');
      if (!el) return;
      clearInterval(timer);
      /* jsdom, where the stories are swept for accessibility, has no scrollIntoView; a throw in this timer ends the whole test run. */
      el.scrollIntoView?.({ block: 'center' });
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

function Marked({ kinds, armed, quiet }: { readonly kinds: Kinds; readonly armed: boolean; readonly quiet: boolean }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, kinds, quiet);
  return (
    <Frame>
      {armed && <Arm />}
      <Look />
      {thread && ready ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Marked> = {
  title: 'Boards/01 Marks',
  component: Marked,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Marked>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** The fixture's one play: one mark, no callout. */
export const OnePlay: Story = { args: { kinds: 1, armed: false, quiet: true } };
/** The same, for a reader who has never met the card: its callout hangs off the mark. */
export const Callout: Story = { args: { kinds: 1, armed: false, quiet: false } };
/** Six kinds on #41: the strip draws four and ends in "+2" (three and "+3" on a phone). */
export const SixKinds: Story = { args: { kinds: 6, armed: false, quiet: true } };
/** Whoops! armed: #41 and #42 end their strips with a dashed ghost mark, "Play Whoops! on post N". */
export const Armed: Story = { args: { kinds: 1, armed: true, quiet: true } };
export const OnePlayPhone: Story = { args: { kinds: 1, armed: false, quiet: true }, ...phone };
export const CalloutPhone: Story = { args: { kinds: 1, armed: false, quiet: false }, ...phone };
export const SixKindsPhone: Story = { args: { kinds: 6, armed: false, quiet: true }, ...phone };
export const ArmedPhone: Story = { args: { kinds: 1, armed: true, quiet: true }, ...phone };
