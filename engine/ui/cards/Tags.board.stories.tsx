/**
 * The plays on a post, quiet, as stories for the owner (docs/plans/2026-10-31-plays-on-a-post-plan.md, Task 6; the
 * mockup they are set against is docs/research/2026-10-31-plays-on-a-post/mock-a-b.html, B, as the owner amended it
 * on #97's shots: a stack that unstacks into a floating list): post #41 of the boards fixture, with one play, three, or
 * six, stacked, unstacked, and with a panel open. No board draws these. Open each at 1440 by 1120, and its `Phone`
 * twin at 390 by 844.
 *
 * #41 carries the fixture's one play. The others are handed to the fake through its seed before the thread is read, so
 * the page bills them as a page read does. The fixture's play has drawn the most: six of the instance's first reaction
 * and two of its second. The next is a card other than #41's, played by #45's author, and has drawn two of the third
 * reaction. The newest is another of #41's card, played by #44's author, and has drawn none. The story names no instance: the casters
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
type Opened = 'none' | 'tag' | 'unstacked' | 'stacked-play';

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
      if (!target || !first) throw new Error('the boards fixture has no #41, or no play on it');
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
        if (!caster) throw new Error('the boards fixture has no author for a post around #41');
        fake.clock.advance(MINUTE);
        const played = fake.seed.card(caster, target.id, card(i), { layer: 2 + i, message: i === 0 ? 'stay a while' : '' });
        if (i === 0) react(played, kinds[2], 2);
      }
      if (live) setReady(true);
      /* A seed the fake refuses leaves the story loading (aria-busy), and says why, rather than showing fewer plays than its name. */
    })().catch((e: unknown) => { console.error('the plays-on-a-post story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, count]);
  return ready;
}

/** Unstacks #41's plays, and opens its tag's panel or the first unstacked play's, once the thread has drawn them, as presses would. */
function Open({ which }: { readonly which: Opened }) {
  useEffect(() => {
    if (which === 'none') return;
    let then: ReturnType<typeof setTimeout> | null = null;
    const timer = setInterval(() => {
      const list = document.querySelector('#post-41 [aria-label="Cards played on this post"]');
      const tag = list?.querySelector<HTMLButtonElement>('.kb-play-tag');
      if (!list || !tag) return;
      clearInterval(timer);
      if (which === 'tag') { tag.click(); return; }
      if (which === 'unstacked') { list.querySelector<HTMLButtonElement>('.kb-play-unstack')?.click(); return; }
      list.querySelector<HTMLButtonElement>('.kb-play-unstack')?.click();
      then = setTimeout(() => list.querySelector<HTMLButtonElement>('.kb-play-unstacked .kb-play-tag')?.click(), 50);
    }, 100);
    return () => { clearInterval(timer); if (then !== null) clearTimeout(then); };
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
/** Three plays, the mockup's, stacked: the most drawn as the tag, two edges behind it, and "+2". */
export const ThreePlays: Story = { args: { count: 3, open: 'none' } };
/** Three plays unstacked: the list floats over the post, which keeps its height. */
export const ThreePlaysUnstacked: Story = { args: { count: 3, open: 'unstacked' } };
/** Six plays, stacked: three edges, and "+5". */
export const SixPlays: Story = { args: { count: 6, open: 'none' } };
export const SixPlaysUnstacked: Story = { args: { count: 6, open: 'unstacked' } };
/** Each with its tag's panel open, or the first unstacked play's. */
export const OnePlayPanel: Story = { args: { count: 1, open: 'tag' } };
export const ThreePlaysPanel: Story = { args: { count: 3, open: 'tag' } };
export const ThreePlaysStackedPlayPanel: Story = { args: { count: 3, open: 'stacked-play' } };
export const SixPlaysPanel: Story = { args: { count: 6, open: 'stacked-play' } };
/** On the Phone board's moment, opened at 390 by 844: the same stack, and the panel is a sheet. */
export const OnePlayPhone: Story = { args: { count: 1, open: 'none' }, ...phone };
export const ThreePlaysPhone: Story = { args: { count: 3, open: 'none' }, ...phone };
export const ThreePlaysUnstackedPhone: Story = { args: { count: 3, open: 'unstacked' }, ...phone };
export const SixPlaysPhone: Story = { args: { count: 6, open: 'none' }, ...phone };
export const SixPlaysUnstackedPhone: Story = { args: { count: 6, open: 'unstacked' }, ...phone };
export const OnePlayPanelPhone: Story = { args: { count: 1, open: 'tag' }, ...phone };
export const ThreePlaysPanelPhone: Story = { args: { count: 3, open: 'tag' }, ...phone };
export const ThreePlaysStackedPlayPanelPhone: Story = { args: { count: 3, open: 'stacked-play' }, ...phone };
export const SixPlaysPanelPhone: Story = { args: { count: 6, open: 'stacked-play' }, ...phone };
