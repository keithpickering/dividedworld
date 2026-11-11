/**
 * Below the Fold as stories for the owner's word (docs/plans/2026-11-11-below-the-fold-plan.md, Task 3): post #41 of the boards fixture at
 * the Main board's moment, folded by a play of #42's author (who is not #41's), on the light board and on the dark. The Opened story is the
 * same post with its bar pressed by the play function (the story route renders no play, so e2e/fold.spec.ts presses the bar itself).
 * Open them at 1440 by 1120.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { userEvent, within } from 'storybook/test';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

interface Args {
  readonly mode: 'light' | 'dark';
}

function Folded({ mode }: Args) {
  const { api } = useKayfa();
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  /* The thread is drawn once the play is seeded: its page is read once, so a play seeded after the read is never drawn. */
  const [seeded, setSeeded] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    return () => { root.removeAttribute('data-kb-mode'); };
  }, [mode]);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!target || !caster?.character) return;
      (api as Fake).seed.card(caster.character, target.id, 'below-the-fold', { layer: 1, live: true, config: {}, message: 'Below the fold' });
      if (live) setSeeded(thread);
    })();
    return () => { live = false; };
  }, [api, thread]);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Folded> = {
  title: 'Boards/20 Below the Fold',
  component: Folded,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { mode: 'light' },
};
export default meta;

type Story = StoryObj<typeof Folded>;

export const FoldedLight: Story = { args: { mode: 'light' } };
export const FoldedDark: Story = { args: { mode: 'dark' } };
export const OpenedLight: Story = {
  args: { mode: 'light' },
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Show post' })); },
};
export const OpenedDark: Story = {
  args: { mode: 'dark' },
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Show post' })); },
};
