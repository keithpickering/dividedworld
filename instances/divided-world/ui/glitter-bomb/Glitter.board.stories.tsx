/**
 * Glitter Bomb on the flakes as stories for the owner's word (docs/plans/2026-11-06-shine-plan.md, Task 10): post #41 of the boards
 * fixture at the Main board's moment with a Glitter Bomb cast on its character, on the light board and the dark board, and under
 * reduced motion (every flake landed, no burst). Open them at 1440 by 1120 and scroll #41 into view: the burst fires the first time
 * 40% of the post is showing, and a mouse passing over it picks glitter up.
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
import { ThreadScreen } from '../../../../engine/ui/thread/Thread.tsx';

declare global { interface Window { __kbShineDraws?: (nth: number) => number } }

interface Args {
  readonly mode: 'light' | 'dark';
  readonly reduced: boolean;
}

function Glittering({ mode, reduced }: Args) {
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
    return () => { delete window.__kbShineDraws; };
  }, []);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!target?.character || !caster?.character) return;
      /* Cast on #41's character from #41 itself, by #42's author, who is not its author. */
      (api as Fake).seed.reach(caster.character, 'character', target.character, 'glitter-bomb', { post: target.id, ends: Date.now() + 5 * 86_400_000, message: 'Sparkle.' });
      /* The page is drawn once the play is seeded, as the page reads plays on a character when it loads and drops one that comes later. */
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the Glitter Bomb could not be seeded', e); });
    return () => { live = false; };
  }, [api, thread]);
  return <Frame>{thread && ready ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}</Frame>;
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
