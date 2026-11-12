/**
 * A post under an author veil and a post under a totals veil (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 8), on the boards fixture's
 * thread at the Main board's moment: `VeiledAndBlind` has #41 under the first card the instance has that hides an author, which its postbit shows
 * as the stand-in, and #42 under the first that hides reaction totals, with the row's one plain line, and a reaction a card added to it. Open it at
 * 1440 by 1120, and its `Phone` twin at 390 by 844: the Main board and the Phone board are the two boards, and each is matched in light and dark.
 *
 * The story names no instance: the cards are found by their rules (`veil`, `reaction`). An instance with none of them draws the posts plain.
 * The plays are made through the fake backend as a player's own (a caster's hand, signed in as her, then back), so what the page shows is what
 * the server would say; the fake's clock is brought to the present first, so a veil lasts from now and not from the fixture's day.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { localKey } from '../../rules/emoji.ts';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { useLocation } from '../router.tsx';

/** Lay the plays on #41 and #42 as a caster of her own, then say the thread is ready to be read. */
function useSeeded(thread: string | null): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      for (const c of instance.cards) await api.meetCard(c.key);
      const acts = await api.acts(thread, 41, 42);
      const first = acts.find((a) => a.seq === 41);
      const second = acts.find((a) => a.seq === 42);
      const me = (await api.session()).account;
      if (!first || !second || me === null) throw new Error('the boards fixture has no #41 and #42 to play on, or no one signed in');
      const author = instance.cards.find((c) => c.veil === 'author');
      const totals = instance.cards.find((c) => c.veil === 'totals');
      const reaction = instance.cards.find((c) => c.reaction === true);
      /* A veil lasts from the fake's now: bring it to this screen's, so the plays are not over before they are drawn. */
      const gap = Date.now() - fake.clock.now();
      if (gap > 0) fake.clock.advance(gap);
      const caster = fake.seed.account('story-caster');
      const face = fake.seed.character(caster, 'Story Caster', instance.classes[0]!.key);
      fake.seed.cards(caster, Object.fromEntries([author, totals, reaction].flatMap((c) => (c ? [[c.key, 1]] : []))));
      fake.signInAs(caster);
      try {
        if (author) await api.playCard(author.key, face, first.id, {}, '');
        if (totals) await api.playCard(totals.key, face, second.id, {}, '');
        if (reaction) await api.playCard(reaction.key, face, second.id, { emoji: '\u{1F480}', quadrant: 'excitedPositive' }, '');
      } finally { fake.signInAs(me); }
      if (reaction) fake.seed.tally(second.id, { [localKey('\u{1F480}')]: 2 });
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the veil story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread]);
  return ready;
}

/** Scrolls #41 to the middle of the window once the thread has drawn it. */
function Look() {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.getElementById('post-41');
      if (!el) return;
      clearInterval(timer);
      el.scrollIntoView?.({ block: 'center' });
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

function Scene() {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread);
  return (
    <Frame>
      <Look />
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Scene> = { title: 'Boards/01 Veiled and blind posts', component: Scene, parameters: { moment: '01-main', layout: 'fullscreen' } };
export default meta;

type Story = StoryObj<typeof Scene>;

/** #41 under an author veil (the stand-in in its postbit), #42 under a totals veil (its row's one line, and a reaction a card added). */
export const VeiledAndBlind: Story = {};
export const VeiledAndBlindPhone: Story = { parameters: { moment: '02-phone' } };
