/**
 * A visit's mark and its Lens tab, one story for each state (the Mod Bots design, section 9; the mocks are docs/research/2026-11-06-mod-bots/01-on-a-visit.png and
 * 02-filed-author.png, shot from the Lens with the visit's pieces laid in; these are the built ones). The boards fixture's #41 is visited by a staff Mod the
 * story seeds, as the tick would, and the Lens is opened from the visit's mark as a reader would: `Quiz` (the mock's: the Mod's question and its answers as
 * full-width block buttons), `Bribe`, `Distraction`, `Filed` (what landed, when it drops off, How it went unfolded), `FiledAuthor` (the same on a post of the
 * reader's own mask, which adds Appeal with its price and terms), `TalkedDown` and `Trapped`. Each has a phone shot, where the Lens takes the window's width.
 *
 * The story names no instance: the Mod is a staff character the story makes, and the role word is whatever the instance's copy says.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Fake, SeedChallenge } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { LoadedThread } from '../loaded.tsx';

const MINUTE = 60_000;
type Which = 'quiz' | 'bribe' | 'distraction' | 'filed' | 'filedAuthor' | 'talkedDown' | 'trapped';

const QUIZ: SeedChallenge = { kind: 'quiz', question: 'Which form is used to request another form?', choices: ['Form 1-A', 'Form 0', 'Form 27-B/6'], answer: 'Form 0' };

/** Visit a post as the state says, then say the thread is ready to be read. */
function useSeeded(thread: string | null, which: Which): boolean {
  const { api } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      const mine = await api.myCharacters();
      /* The HUD's mask as the player loads it: the one chosen on this device, else the first that can act (player.tsx). */
      const account = (await api.session()).account;
      let chosen: string | null = null;
      try { chosen = account ? localStorage.getItem(hudKey(account)) : null; } catch { chosen = null; }
      const acting = mine.filter((c) => c.debutedAt !== null && c.retiredAt === null);
      const mask = acting.find((c) => c.id === chosen) ?? acting[0];
      /* The author's own post is one the reader's mask wrote: the boards fixture's #41 is another character's. */
      let post = (await api.acts(thread, 41, 41))[0]?.id;
      if (which === 'filedAuthor') {
        if (!mask) throw new Error('the story needs a reader with a mask to be the author');
        post = fake.seed.post(thread, mask.id, 'I wrote the changelog at 9:13, posted it here at 9:14, then realized I forgot the hats.');
      }
      if (!post) throw new Error('the boards fixture has no #41');
      const clerk = fake.seed.staff('story-clerk', 'The Clerk', 'mod');
      const visit = fake.seed.visit(clerk, post, {
        at: Date.now(), endsInMs: 161 * MINUTE, line: 'Routine inspection.',
        challenge: which === 'bribe' ? { kind: 'bribe', price: 50 } : which === 'distraction' || which === 'trapped' ? { kind: 'distraction' } : QUIZ,
      });
      if (which === 'filed' || which === 'filedAuthor') {
        fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Stamped, initialed, and filed under D.', at: Date.now() + MINUTE });
        fake.seed.infraction(visit, { points: 2, at: Date.now() + MINUTE });
      }
      if (which === 'talkedDown') fake.seed.visitEnd(visit, { outcome: 'intercepted', line: 'Talked down.' });
      if (which === 'trapped') fake.seed.visitEnd(visit, { outcome: 'trapped', line: 'A trap set on this post sprang as the visit began, and the visit ended.' });
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the visit story could not be seeded', e); });
    return () => { live = false; };
  }, [api, thread, which]);
  return ready;
}

/** Opens the visit's Lens from its mark, and for a filed visit unfolds How it went. */
function Opened({ unfold }: { readonly unfold: boolean }) {
  useEffect(() => {
    let step = 0;
    const timer = setInterval(() => {
      if (step === 0) {
        const mark = document.querySelector<HTMLElement>('.kb-visit-mark');
        if (!mark) return;
        mark.scrollIntoView?.({ block: 'center' });
        mark.click();
        step = 1;
      } else {
        const fold = document.querySelector<HTMLElement>('.kb-visit .kb-lens-fold');
        if (!fold) return;
        clearInterval(timer);
        if (unfold && fold.getAttribute('aria-expanded') === 'false') fold.click();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [unfold]);
  return null;
}

function Visited({ which }: { readonly which: Which }) {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, which);
  return (
    <Frame>
      {ready && <Opened unfold={which === 'filed' || which === 'filedAuthor'} />}
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Visited> = {
  title: 'Boards/01 Lens: a visit',
  component: Visited,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Visited>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** Open, a quiz: the Mod's question and the answers as full-width block buttons with centered text. */
export const Quiz: Story = { args: { which: 'quiz' } };
/** Open, a bribe: one button with its price. */
export const Bribe: Story = { args: { which: 'bribe' } };
/** Open, a distraction: a line saying any card cast on the thread talks it down. */
export const Distraction: Story = { args: { which: 'distraction' } };
/** Filed, as another player's reader sees it: what landed, when it drops off, How it went. */
export const Filed: Story = { args: { which: 'filed' } };
/** Filed, on a post of the reader's own mask: Appeal with its price and terms. */
export const FiledAuthor: Story = { args: { which: 'filedAuthor' } };
export const TalkedDown: Story = { args: { which: 'talkedDown' } };
export const Trapped: Story = { args: { which: 'trapped' } };
export const QuizPhone: Story = { args: { which: 'quiz' }, ...phone };
export const BribePhone: Story = { args: { which: 'bribe' }, ...phone };
export const DistractionPhone: Story = { args: { which: 'distraction' }, ...phone };
export const FiledPhone: Story = { args: { which: 'filed' }, ...phone };
export const FiledAuthorPhone: Story = { args: { which: 'filedAuthor' }, ...phone };
export const TalkedDownPhone: Story = { args: { which: 'talkedDown' }, ...phone };
export const TrappedPhone: Story = { args: { which: 'trapped' }, ...phone };
