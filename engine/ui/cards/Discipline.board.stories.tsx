/**
 * The discipline cards' Lens (docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 7), one story for each state, on the boards fixture's player, whose HUD is on a mask the
 * story finds: `AHeart` (the heart's mark on the post it was played from: what it took off the warn bar and when), `AFallWaiting` (a fall on the fixture's #41: whom a filing
 * would land on, whom it spares, and how it ends), `AFallTaken` (the same fall after a Mod's visit filed: "Took the fall" and where the points landed) and `ToldOn` (a watch on the
 * reader's own character: how heavily a patrol weighs its posts, and until when). Each opens the Lens from the card's mark with Who unfolded, as a reader would.
 * Each card is found by its rules (`discipline.kind`), naming no card and no instance, and the mask the reader acts as is the one the player loads (player.tsx).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import type { CardRules } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { LoadedThread } from '../loaded.tsx';

type Scene = 'heart' | 'fallWaiting' | 'fallTaken' | 'toldOn';

const DAY = 86_400_000;
/** The card each scene is about, by what its rules say it does. */
const found = (cards: readonly CardRules[], scene: Scene): CardRules | undefined => {
  const kind = scene === 'heart' ? 'relief' : scene === 'toldOn' ? 'watch' : 'fall';
  return cards.find((c) => c.discipline?.kind === kind);
};

/** Seeds the scene on the thread the fixture opens, and says when it is ready to be read. */
function useSeeded(scene: Scene, thread: string | null): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      for (const c of instance.cards) await api.meetCard(c.key);
      const session = await api.session();
      if (session.account === null) throw new Error('the story needs a signed-in player');
      /* The HUD's mask as the player loads it: the one chosen on this device, else the first that can act (player.tsx). */
      let chosen: string | null = null;
      try { chosen = localStorage.getItem(hudKey(session.account)); } catch { chosen = null; }
      const acting = (await api.myCharacters()).filter((c) => c.debutedAt !== null && c.retiredAt === null);
      const mask = acting.find((c) => c.id === chosen) ?? acting[0];
      const card = found(instance.cards, scene);
      if (!mask || !card) throw new Error('the boards fixture has no mask to act as, or the instance has no such card');
      const clerk = fake.seed.staff('story-clerk', 'The Clerk', 'mod');
      const first = (await api.acts(thread, 41, 41))[0];
      if (!first) throw new Error('the boards fixture has no #41');
      if (scene === 'heart') {
        /* A heart the mask plays on itself, from a post of its own, after a filing that left points on the bar. */
        const own = fake.seed.post(thread, mask.id, 'I wrote the changelog at 9:13, posted it here at 9:14, then realized I forgot the hats.');
        fake.seed.infraction(fake.seed.visit(clerk, own, { at: Date.now() - 2 * DAY }), { points: 4, at: Date.now() - 2 * DAY });
        fake.seed.cards(session.account, { [card.key]: 1 });
        fake.seed.wallet(session.account, 100_000);
        const played = await api.playCard(card.key, mask.id, mask.id, {}, '', 'character', own);
        if (!played.ok) throw new Error(`the heart was refused: ${played.error}`);
      } else if (scene === 'toldOn') {
        const own = fake.seed.post(thread, mask.id, 'Somebody told on me.');
        if (first.character === null) throw new Error('#41 has no author to tell on the mask');
        fake.seed.reach(first.character, 'character', mask.id, card.key, { post: own, ends: Date.now() + 5 * DAY });
      } else {
        /* A fall the mask cast on #41, another character's post; and where it is taken, a Mod's visit to #41 that has filed, which lands on the mask. */
        fake.seed.card(mask.id, first.id, card.key);
        if (scene === 'fallTaken') {
          const visit = fake.seed.visit(clerk, first.id, { at: Date.now() - DAY, endsInMs: 3_600_000, line: 'Routine inspection.' });
          fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Stamped, initialed, and filed under D.', at: Date.now() - DAY + 60_000 });
          fake.seed.infraction(visit, { points: 2, at: Date.now() - DAY + 60_000 });
        }
      }
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the story could not be seeded', String(e)); });
    return () => { live = false; };
  }, [api, instance, scene, thread]);
  return ready;
}

/** Does what a player does: presses the card's mark to open its Lens, then unfolds Who. */
function Opened({ scene }: { readonly scene: Scene }) {
  const { instance } = useKayfa();
  useEffect(() => {
    const key = found(instance.cards, scene)?.key ?? '';
    let step = 0;
    const timer = setInterval(() => {
      if (step === 0) {
        const mark = document.querySelector<HTMLElement>(`.kb-mark[data-kb-card="${key}"]`);
        if (!mark) return;
        mark.scrollIntoView?.({ block: 'center' });
        mark.click();
        step = 1;
      } else {
        const fold = document.querySelector<HTMLElement>('.kb-lens .kb-lens-fold');
        if (!fold) return;
        clearInterval(timer);
        if (fold.getAttribute('aria-expanded') === 'false') fold.click();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [instance, scene]);
  return null;
}

function Story({ scene }: { readonly scene: Scene }) {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(scene, thread);
  return (
    <Frame>
      {ready && <Opened scene={scene} />}
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Story> = { title: 'Boards/01 Lens: discipline cards', component: Story, parameters: { moment: '01-main', layout: 'fullscreen' } };
export default meta;
type S = StoryObj<typeof Story>;

/** A heart the mask played on itself: its mark on the post it was played from, and the row that says what it took off the warn bar and when. */
export const AHeart: S = { args: { scene: 'heart' } };
/** A fall waiting on #41: the Lens says whom a filing would land on, whom it spares, and that it ends when a visit files or an admin ends it. */
export const AFallWaiting: S = { args: { scene: 'fallWaiting' } };
/** The same fall after a visit to #41 filed: "Took the fall", and where the warn points landed. */
export const AFallTaken: S = { args: { scene: 'fallTaken' } };
/** A watch on the reader's own character: how heavily a patrol weighs its posts, and until when. */
export const ToldOn: S = { args: { scene: 'toldOn' } };
