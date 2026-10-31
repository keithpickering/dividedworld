/**
 * The plays on a post, quiet, as stories for the owner (docs/plans/2026-10-31-plays-on-a-post-plan.md, Task 6; the
 * mockup they are set against is docs/research/2026-10-31-plays-on-a-post/mock-a-b.html, B): post #41 of the boards
 * fixture, with one play, three, or six, and each with its panel open. No board draws these. Open each at 1440 by 1120,
 * and its `Phone` twin at 390 by 844.
 *
 * #41 carries the fixture's one play. The others are handed to the fake through its seed before the thread is read, so
 * the page bills them as a page read does: the fixture's play has drawn the most (the instance's first two reactions,
 * six and two), the next (a card other than #41's, by #45's author) has drawn two of the third, and the newest (another
 * of #41's card, by #44's author) none. The story names no instance: the casters
 * are the authors of the posts around #41, the cards are the instance's own in its order, and the reactions its own.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { useLocation } from '../router.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';

const MINUTE = 60_000;

type Count = 1 | 3 | 6;
type Opened = 'none' | 'tag' | 'chip';

/** Hand #41 its plays and their reactions, then say it is ready to be read. */
function useSeeded(thread: string | null, count: Count): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(count === 1);
  useEffect(() => {
    if (thread === null || count === 1) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      const acts = await api.acts(thread, 41, 46);
      const by = (seq: number) => acts.find((a) => a.seq === seq)?.character ?? null;
      const target = acts.find((a) => a.seq === 41);
      const [first] = target ? await api.cardsOn(target.id, 1) : [];
      if (!target || !first) return;
      /* The other plays alternate between a card that is not #41's and #41's own, so the newest is another of the fixture's card. */
      const other = instance.cards.map((c) => c.key).find((k) => k !== first.payload.card) ?? String(first.payload.card);
      const card = (i: number) => (i % 2 === 0 ? other : String(first.payload.card));
      const kinds = instance.reactions.map((r) => r.key);
      let fans = 0;
      const react = (act: string, kind: string | undefined, times: number) => {
        if (kind === undefined) return;
        for (let i = 0; i < times; i++) {
          const account = fake.seed.account(`story-fan-${++fans}`);
          fake.seed.react(account, fake.seed.character(account, `Story fan ${fans}`, instance.classes[0]!.key), act, kind);
        }
      };
      /* The fixture's play has drawn the most. */
      react(first.id, kinds[0], 6);
      react(first.id, kinds[1], 2);
      const casters = [by(45), by(44), by(43), by(42), by(45)];
      for (let i = 0; i < count - 1; i++) {
        const caster = casters[i];
        if (!caster) continue;
        fake.clock.advance(MINUTE);
        const played = fake.seed.card(caster, target.id, card(i), { layer: 2 + i, message: i === 0 ? 'stay a while' : '' });
        if (i === 0) react(played, kinds[2], 2);
      }
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [api, instance, thread, count]);
  return ready;
}

/** Opens #41's tag or its first chip once the thread has drawn them, as a press would. */
function Open({ which }: { readonly which: Opened }) {
  useEffect(() => {
    if (which === 'none') return;
    const timer = setInterval(() => {
      const list = document.querySelector('#post-41 [aria-label="Cards played on this post"]');
      const button = list?.querySelector<HTMLButtonElement>(which === 'tag' ? '.kb-play-tag' : '.kb-play-chip, .kb-play-more');
      if (!button) return;
      clearInterval(timer);
      /* At the phone's width the chips are folded: "+N more" opens them first. */
      if (button.classList.contains('kb-play-more')) {
        button.click();
        setTimeout(() => list?.querySelector<HTMLButtonElement>('.kb-play-chip')?.click(), 50);
      } else button.click();
    }, 100);
    return () => clearInterval(timer);
  }, [which]);
  return null;
}

/** Scrolls #41 into view once it is drawn. */
function Look() {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.getElementById('post-41');
      if (!el) return;
      clearInterval(timer);
      el.scrollIntoView?.({ block: 'start' });
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

function Tags({ count, open }: { readonly count: Count; readonly open: Opened }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, count);
  return (
    <Frame>
      <Look />
      <Open which={open} />
      {thread && ready ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Tags> = {
  title: 'Boards/01 Plays on a post',
  component: Tags,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Tags>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** One play: the tag alone. */
export const OnePlay: Story = { args: { count: 1, open: 'none' } };
/** Three plays, the mockup's: the most drawn as the tag, then two chips. */
export const ThreePlays: Story = { args: { count: 3, open: 'none' } };
/** Six plays: the tag, three chips and "+2 more". */
export const SixPlays: Story = { args: { count: 6, open: 'none' } };
export const OnePlayPanel: Story = { args: { count: 1, open: 'tag' } };
export const ThreePlaysPanel: Story = { args: { count: 3, open: 'tag' } };
export const ThreePlaysChipPanel: Story = { args: { count: 3, open: 'chip' } };
export const SixPlaysPanel: Story = { args: { count: 6, open: 'chip' } };
/** On the Phone board's moment, opened at 390 by 844: no chips, only "+N more", and the panel is a sheet. */
export const OnePlayPhone: Story = { args: { count: 1, open: 'none' }, ...phone };
export const ThreePlaysPhone: Story = { args: { count: 3, open: 'none' }, ...phone };
export const SixPlaysPhone: Story = { args: { count: 6, open: 'none' }, ...phone };
export const OnePlayPanelPhone: Story = { args: { count: 1, open: 'tag' }, ...phone };
export const ThreePlaysPanelPhone: Story = { args: { count: 3, open: 'tag' }, ...phone };
export const ThreePlaysChipPanelPhone: Story = { args: { count: 3, open: 'chip' }, ...phone };
export const SixPlaysPanelPhone: Story = { args: { count: 6, open: 'chip' }, ...phone };
