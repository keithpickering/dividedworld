/**
 * A post under an author veil and a post under a totals veil (docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 8), on the boards fixture's
 * thread at the Main board's moment: `VeiledAndBlind` has #41 under the first card the instance has that hides an author, which its postbit shows
 * as the stand-in, and #42 under the first that hides reaction totals, with the row's one plain line, and a reaction a card added to it. Open it at
 * 1440 by 1120, and its `Phone` twin at 390 by 844: the Main board and the Phone board are the two boards, and each is matched in light and dark.
 *
 * The same posts are drawn for the others who meet them (card notes Part 3, Task 12). The player of the `01-main` moment owns both posts' authors, so `VeiledAndBlind`
 * is the author's own view: the stand-in in her postbit, and the row's line that says only she and the caster see the totals. `Reader` is a third reader, the rival
 * of the `03-react` moment (the story that holds the picker): the stand-in, the totals hidden and only her own reactions drawn, and a picker that offers the kind a card
 * added; `Caster` is #42 as the player who cast the blind card on it reads it (the totals, and the line that says the author sees them too); and `StandInProfile` is the
 * stand-in's own profile, as it is opened from a veiled post's name. The board's size is the window's: open each at 1440 by 1120, and again at 390 by 844 for the Phone board.
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
import { LoadedProfile, LoadedThread } from '../loaded.tsx';
import { useLocation } from '../router.tsx';

type Scene = 'author' | 'reader' | 'caster' | 'standIn';

/** The post each scene looks at: the veiled one, or the one the caster cast the blind card on. */
const LOOK: Readonly<Record<Scene, number | null>> = { author: 41, reader: 41, caster: 42, standIn: null };

/** Lay the plays on #41 and #42 as a caster of her own, then say the page is ready to be read; and the stand-in's id, for its profile. */
function useSeeded(thread: string | null, scene: Scene): { readonly ready: boolean; readonly standIn: string | null } {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  const [standIn, setStandIn] = useState<string | null>(null);
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
      } finally { if (scene !== 'caster') fake.signInAs(me); }
      if (reaction) fake.seed.tally(second.id, { [localKey('\u{1F480}')]: 2 });
      /* The stand-in's id is the character a veiled post is read under. */
      const veiled = (await api.acts(thread, 41, 41))[0]?.character ?? null;
      if (live) { setStandIn(veiled); setReady(true); }
    })().catch((e: unknown) => { console.error('the veil story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, scene]);
  return { ready, standIn };
}

/** Scrolls the scene's post to the middle of the window once the thread has drawn it. */
function Look({ seq }: { readonly seq: number }) {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.getElementById(`post-${seq}`);
      if (!el) return;
      clearInterval(timer);
      el.scrollIntoView?.({ block: 'center' });
    }, 100);
    return () => clearInterval(timer);
  }, [seq]);
  return null;
}

function Seen({ scene }: { readonly scene: Scene }) {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const { ready, standIn } = useSeeded(thread, scene);
  const seq = LOOK[scene];
  return (
    <Frame>
      {seq !== null && <Look seq={seq} />}
      {!ready ? <div aria-busy="true" /> : scene === 'standIn' ? (standIn !== null ? <LoadedProfile id={standIn} /> : <div aria-busy="true" />) : thread && <LoadedThread thread={thread} />}
    </Frame>
  );
}

const meta: Meta<typeof Seen> = { title: 'Boards/01 Veiled and blind posts', component: Seen, args: { scene: 'reader' }, parameters: { moment: '01-main', layout: 'fullscreen' } };
export default meta;

type Story = StoryObj<typeof Seen>;

/** #41 under an author veil (the stand-in in its postbit), #42 under a totals veil (its row's one line, and a reaction a card added), as the player who owns both authors reads them. */
export const VeiledAndBlind: Story = { args: { scene: 'author' } };
export const VeiledAndBlindPhone: Story = { args: { scene: 'author' }, parameters: { moment: '02-phone' } };

/** The same two posts as a third reader, the rival, reads them: the stand-in, totals she cannot see, and the picker on #42 offering the card's kind. */
export const Reader: Story = { args: { scene: 'reader' }, parameters: { moment: '03-react' } };
/** #42 as the player who cast the blind card on it reads it: the totals, and the line that says the author sees them too. */
export const Caster: Story = { args: { scene: 'caster' }, parameters: { moment: '03-react' } };
/** The stand-in's profile, opened from a veiled post's name: a character with a name, a tagline and nothing else a player could trace. */
export const StandInProfile: Story = { args: { scene: 'standIn' } };
