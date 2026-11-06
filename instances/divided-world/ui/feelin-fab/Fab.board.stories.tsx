/**
 * Feelin' Fab's three levels as stories for the owner's word (docs/plans/2026-11-02-onboarding-plan.md, Task 10): post #41 of the boards
 * fixture at the Main board's moment with one, two and three Feelin' Fabs up, on the light board and the dark board, and under reduced
 * motion (the foil drawn once, at rest). The plays come from #42's author, who is not #41's. Open them at
 * 1440 by 1120; scroll #41 into view, since the foil is drawn only while its post is. The Twenty stories are the plan's scroll check: a
 * thread of twenty Feelin' Fab posts (a whole page, #41 to #60), mixed levels, to scroll and watch for dropped frames.
 *
 * The story page hands e2e/fab.spec.ts the loop's probe (`window.__kbShineDraws(n)`: how many times the loop has drawn the nth
 * Feelin' Fab on the page), the way the other board stories reach their internals; the app itself exposes nothing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { probe } from '../../../../engine/ui/shine/loop.ts';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

declare global { interface Window { __kbShineDraws?: (nth: number) => number } }

interface Args {
  readonly level: 1 | 2 | 3;
  readonly mode: 'light' | 'dark';
  readonly reduced: boolean;
  /** Twenty posts carry Feelin' Fabs, at levels one to three in turn, instead of #41 alone. */
  readonly many?: boolean;
}

function Fabbed({ level, mode, reduced, many = false }: Args) {
  const { api } = useKayfa();
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  /* The thread is drawn once the plays are seeded: its page is read once, so a play seeded after the read, and before the page listens, is never drawn. */
  const [seeded, setSeeded] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    if (reduced) root.setAttribute('data-kb-motion', 'reduce'); else root.setAttribute('data-kb-motion', 'full');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [mode, reduced]);
  useEffect(() => {
    window.__kbShineDraws = (nth) => probe.draws(document.querySelectorAll('[data-kb-fab]')[nth] ?? {});
    return () => { delete window.__kbShineDraws; };
  }, []);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!target || !caster?.character) return;
      if (many) {
        const fake = api as Fake;
        /* One page of the thread, seq 41 to 60 (the page holds twenty): the fixture has #41 to #46, so 14 more posts of #41's author fill it. */
        for (let i = 0; i < 14; i += 1) fake.seed.post(thread, target.character!, `Post ${i + 47} of the scroll check. ${'The rainbow sits under these words, which must stay readable as it moves. '.repeat(1 + (i % 3))}`);
        const page = (await api.acts(thread, 41, 60)).filter((a) => a.kind === 'post');
        /* Each is played on by a character that is not its author: #42's author, or #41's author on #42 itself. */
        page.forEach((post, i) => {
          const from = post.character === caster.character ? target.character! : caster.character!;
          for (let layer = 1; layer <= (i % 3) + 1; layer += 1) fake.seed.card(from, post.id, 'feelin-fab', { layer, live: true, config: {}, message: `Fab ${layer}` });
        });
      } else {
        for (let layer = 1; layer <= level; layer += 1) (api as Fake).seed.card(caster.character, target.id, 'feelin-fab', { layer, live: true, config: {}, message: `Fab ${layer}` });
      }
      if (live) setSeeded(thread);
    })();
    return () => { live = false; };
  }, [api, thread, level, many]);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Fabbed> = {
  title: "Boards/10 Feelin' Fab",
  component: Fabbed,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { level: 1, mode: 'light', reduced: false },
};
export default meta;

type Story = StoryObj<typeof Fabbed>;

export const OneLight: Story = { args: { level: 1, mode: 'light' } };
export const TwoLight: Story = { args: { level: 2, mode: 'light' } };
export const ThreeLight: Story = { args: { level: 3, mode: 'light' } };
export const OneDark: Story = { args: { level: 1, mode: 'dark' } };
export const TwoDark: Story = { args: { level: 2, mode: 'dark' } };
export const ThreeDark: Story = { args: { level: 3, mode: 'dark' } };
export const OneStill: Story = { args: { level: 1, reduced: true } };
export const TwoStill: Story = { args: { level: 2, reduced: true } };
export const ThreeStill: Story = { args: { level: 3, reduced: true, mode: 'dark' } };
export const TwentyLight: Story = { args: { many: true, mode: 'light' } };
export const TwentyDark: Story = { args: { many: true, mode: 'dark' } };
