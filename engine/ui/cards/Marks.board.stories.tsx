/**
 * The marks on a post, quiet, as stories for the owner (docs/plans/2026-10-31-marks-and-the-lens-plan.md, Task 8; the mockup they
 * are set against is docs/research/2026-10-31-marks-and-the-lens/, whose Lens and takeover stories are the instance's:
 * instances/divided-world/ui/whoops/Lens.board.stories.tsx). Post #41 of the boards fixture, read at the Main board's moment, with
 * its marks: `OnePlay` (the fixture's one play, its card met before so no callout hangs), `Callout` (the same for a reader who has
 * never met the card, so its one-line callout hangs off the mark), `SixKinds` (six kinds of card on one post: four marks and
 * "+2"), and `Armed` (Whoops! armed the way pressing its card in the hand arms it: the dashed ghost mark ends the strip of every post it
 * can land on, #41 and #42 among them), `AsItLanded` (the fixture's play's moment shown in #41's body, from its Lens's As it landed), `EndThisCard` (an admin's Lens, with its End this card), `EndedByAnAdmin` (the same play after an admin ended it) and `SpunFromAPlay` (a thread spun from a takeover card's play on #41, over its Whoops!: the play's moment in the ORIGIN box). No board draws these. Open each at 1440 by 1120, and its `Phone` twin at 390 by 844.
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
import { useLocation, useNavigate } from '../router.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { usePlay } from './play.tsx';
import { LoadedThread } from '../loaded.tsx';

const MINUTE = 60_000;

type Kinds = 1 | 6;
/** An admin looking at #41's play: its Lens offers "End this card" (`admin`), or the play was ended already and its Lens says so (`ended`). */
type Ending = 'none' | 'admin' | 'ended';

/** Hand #41 its plays (and, for `quiet`, say every card met), then say the thread is ready to be read. */
function useSeeded(thread: string | null, kinds: Kinds, quiet: boolean, ending: Ending): boolean {
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
      if (ending !== 'none') {
        /* The reader is made an admin before the thread is read, as the account is; an ended play is ended by that admin, as the Lens would. */
        const account = (await api.session()).account;
        if (account === null) throw new Error('the story needs a signed-in reader to make an admin');
        fake.seed.admin(account);
        if (ending === 'ended') {
          const target = (await api.acts(thread, 41, 41))[0];
          const play = target && (await api.cardsOn(target.id, 8)).find((a) => a.kind === 'card');
          if (!play) throw new Error('the boards fixture has no play on #41 to end');
          const answer = await api.reverseCard(play.id);
          if (!answer.ok) throw new Error(answer.error);
        }
      }
      if (live) setReady(true);
      /* A seed the fake refuses leaves the story loading (aria-busy), and says why, rather than showing fewer kinds than its name. */
    })().catch((e: unknown) => { console.error('the marks story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, kinds, quiet, ending]);
  return ready;
}

/** Arms the instance's first card with settings of its own (a `ConfigForm`), as the player's press in the hand does: the story names no card. */
function Arm() {
  const { ui } = useKayfa();
  const play = usePlay();
  const key = ui.cards.find((c) => c.ConfigForm !== undefined)?.key ?? null;
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

/**
 * Opens #41's Lens from its first mark, unfolds Who and presses the first play's As it landed, as a reader would: #41's body is then
 * that play's moment, in its frame, over the post's live layer as it stands.
 */
function Landed() {
  useEffect(() => {
    let step = 0;
    const timer = setInterval(() => {
      const article = document.getElementById('post-41');
      if (step === 0) {
        const mark = article?.querySelector<HTMLElement>('.kb-mark[data-kb-card]');
        if (!mark) return;
        mark.click();
        step = 1;
      } else if (step === 1) {
        const fold = document.querySelector<HTMLElement>('.kb-lens-fold');
        if (!fold) return;
        if (fold.getAttribute('aria-expanded') === 'false') fold.click();
        step = 2;
      } else {
        const landed = [...document.querySelectorAll<HTMLElement>('.kb-lens-row button')].find((b) => b.textContent === 'As it landed');
        if (!landed) return;
        clearInterval(timer);
        landed.click();
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

/** Opens #41's Lens from its first mark and unfolds Who, as a reader would, so each play's row (and, for an admin, "End this card") is in view. */
function Opened() {
  useEffect(() => {
    let step = 0;
    const timer = setInterval(() => {
      if (step === 0) {
        const mark = document.getElementById('post-41')?.querySelector<HTMLElement>('.kb-mark[data-kb-card]');
        if (!mark) return;
        mark.click();
        step = 1;
      } else {
        const fold = document.querySelector<HTMLElement>('.kb-lens-fold');
        if (!fold) return;
        clearInterval(timer);
        if (fold.getAttribute('aria-expanded') === 'false') fold.click();
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

/**
 * A thread spun from a play on #41: the instance's takeover card (the story names none) is played on #41 over the fixture's play, the
 * reader spins a thread from it as one of their own characters, and the story moves to that thread, whose ORIGIN box draws the play's
 * moment: #41 as it read then, the fixture's play drawn still under it.
 */
function SpunFromPlay() {
  const { api, ui } = useKayfa();
  const navigate = useNavigate();
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const [spun, setSpun] = useState<string | null>(null);
  useEffect(() => {
    if (thread === null || spun !== null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      const acts = await api.acts(thread, 41, 42);
      const target = acts.find((a) => a.seq === 41);
      const caster = acts.find((a) => a.seq === 42)?.character ?? null;
      const key = ui.cards.find((c) => c.takeover === true)?.key;
      const me = (await api.myCharacters())[0];
      if (!target || caster === null || key === undefined || !me) throw new Error('the boards fixture has no #41 and #42, the instance no takeover card, or the reader no character');
      fake.clock.advance(MINUTE);
      const play = fake.seed.card(caster, target.id, key, { message: '' });
      const answer = await api.spin(play, me.id, 'About that hold', 'Of all the posts to be held on.');
      if (!answer.ok) throw new Error(answer.error);
      if (!live) return;
      setSpun(answer.value.thread.id);
      navigate(`/t/${answer.value.thread.id}`);
    })().catch((e: unknown) => { console.error('the spun story could not be seeded', e); });
    return () => { live = false; };
  }, [api, ui, thread, spun, navigate]);
  return (
    <Frame>
      {spun !== null && thread === spun ? <LoadedThread thread={spun} /> : <div aria-busy="true" />}
    </Frame>
  );
}

function Marked({ kinds, armed, quiet, landed = false, ending = 'none' }: { readonly kinds: Kinds; readonly armed: boolean; readonly quiet: boolean; readonly landed?: boolean; readonly ending?: Ending }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, kinds, quiet, ending);
  return (
    <Frame>
      {armed && <Arm />}
      {landed && <Landed />}
      {ending !== 'none' && <Opened />}
      <Look />
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
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
/** Six kinds on #41: the strip draws four and ends in "+2" (two and "+4" on a phone). */
export const SixKinds: Story = { args: { kinds: 6, armed: false, quiet: true } };
/** Whoops! armed: #41 and #42 end their strips with a dashed ghost mark, "Play Whoops! on post N". */
export const Armed: Story = { args: { kinds: 1, armed: true, quiet: true } };
export const OnePlayPhone: Story = { args: { kinds: 1, armed: false, quiet: true }, ...phone };
export const CalloutPhone: Story = { args: { kinds: 1, armed: false, quiet: false }, ...phone };
export const SixKindsPhone: Story = { args: { kinds: 6, armed: false, quiet: true }, ...phone };
export const ArmedPhone: Story = { args: { kinds: 1, armed: true, quiet: true }, ...phone };
/** As it landed (docs/plans/2026-11-03-effect-history-plan.md, Task 5): #41's play's moment in its frame and tag, the Lens open beside it. */
export const AsItLanded: Story = { args: { kinds: 1, armed: false, quiet: true, landed: true } };
export const AsItLandedPhone: Story = { args: { kinds: 1, armed: false, quiet: true, landed: true }, ...phone };
/** An admin's Lens on #41's play: Who unfolded, and "End this card" on the live play. */
export const EndThisCard: Story = { args: { kinds: 1, armed: false, quiet: true, ending: 'admin' } };
/** The same play after an admin ended it: its mark is dim and its Lens reads "Ended by an admin"; no button is left. */
export const EndedByAnAdmin: Story = { args: { kinds: 1, armed: false, quiet: true, ending: 'ended' } };
export const EndThisCardPhone: Story = { args: { kinds: 1, armed: false, quiet: true, ending: 'admin' }, ...phone };
export const EndedByAnAdminPhone: Story = { args: { kinds: 1, armed: false, quiet: true, ending: 'ended' }, ...phone };
/** A thread spun from a takeover card's play on #41: its ORIGIN box draws the play's moment, #41 as it read then. */
export const SpunFromAPlay: Story = { render: () => <SpunFromPlay /> };
export const SpunFromAPlayPhone: Story = { render: () => <SpunFromPlay />, ...phone };
