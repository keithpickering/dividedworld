/**
 * Glitter Bomb on the flakes as stories for the owner's word (docs/plans/2026-11-06-shine-plan.md, Task 10): post #41 of the boards
 * fixture at the Main board's moment with a Glitter Bomb cast on its character, on the light board and the dark board, and under
 * reduced motion (every flake landed, no burst), and Kept: the bomb wore off three days ago and #41's author wrote a post in its week, so
 * that post loads settled with no burst (the post written after the week is bare; docs/plans/2026-11-12-glitter-keeps-design.md). Open them at 1440 by 1120 and scroll #41 into view: the burst fires once its burst
 * point has stayed in the middle of the view for 300 ms, a mouse passing over it picks glitter up, and a fast scroll shakes some off.
 *
 * The story page hands e2e/shine.spec.ts the loop's probe (`window.__kbShineDraws(n)`: how many times the loop has drawn the nth
 * Glitter Bomb on the page), the way the other board stories reach their internals; the app itself exposes nothing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { probe } from '../../../../engine/ui/shine/loop.ts';
import { probe as landing } from '../../../../engine/ui/shine/landing.ts';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

declare global { interface Window { __kbShineDraws?: (nth: number) => number; __kbLanding?: typeof landing } }

interface Args {
  readonly mode: 'light' | 'dark';
  readonly reduced: boolean;
  /** The bomb has worn off: a post of the character written in its week keeps the glitter, loaded settled. */
  readonly kept?: boolean;
}

const DAY = 86_400_000;

function Glittering({ mode, reduced, kept = false }: Args) {
  const { api } = useKayfa();
  const [ready, setReady] = useState(false);
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    root.setAttribute('data-kb-motion', reduced ? 'reduce' : 'full');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [mode, reduced]);
  useEffect(() => {
    window.__kbShineDraws = (nth) => probe.draws(document.querySelectorAll('[data-kb-glitter]')[nth] ?? {});
    window.__kbLanding = landing;
    return () => { delete window.__kbShineDraws; delete window.__kbLanding; };
  }, []);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!target?.character || !caster?.character) return;
      /* Cast on #41's character from #41 itself, by #42's author, who is not its author. */
      const fake = api as Fake;
      if (kept) {
        /* Cast ten days ago, worn off three days ago: a post of #41's author four days ago was written in its week and keeps it, one a day ago was not. */
        const now = api.now();
        fake.seed.reach(caster.character, 'character', target.character, 'glitter-bomb', { post: target.id, at: now - 10 * DAY, ends: now - 3 * DAY, message: 'Sparkle.' });
        fake.seed.post(thread, target.character, 'Written in the Glitter Bomb\'s week, so it keeps its sparkle.', { at: now - 4 * DAY });
        fake.seed.post(thread, target.character, 'Written after the week, so it is bare.', { at: now - DAY });
      } else fake.seed.reach(caster.character, 'character', target.character, 'glitter-bomb', { post: target.id, ends: Date.now() + 5 * DAY, message: 'Sparkle.' });
      /* The page is drawn once the play is seeded, as the page reads plays on a character when it loads and drops one that comes later. */
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the Glitter Bomb could not be seeded', e); });
    return () => { live = false; };
  }, [api, thread, kept]);
  return <Frame>{thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Glittering> = {
  title: 'Boards/09 Glitter Bomb',
  component: Glittering,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { mode: 'light', reduced: false },
};
export default meta;

type Story = StoryObj<typeof Glittering>;

export const Light: Story = { args: { mode: 'light' } };
export const Dark: Story = { args: { mode: 'dark' } };
export const Still: Story = { args: { reduced: true } };
export const Kept: Story = { args: { kept: true } };
