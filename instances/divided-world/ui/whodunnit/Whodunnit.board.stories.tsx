/**
 * Whodunnit? as stories for the owner's word (card notes Part 3, Task 11): post #43 of the boards fixture at the Main board's moment (the one post of the
 * page that carries no ink over its words, so the line under them can be read), once the card has worn off (a play of #42's author whose end was two days ago), on the light board and on the dark: the post under its true
 * name with the one small line under its words. The veil while it is up is not a story: it is the engine's, a row the play lands, and the
 * fake's seed writes none, so a seeded play would show the true name under a line saying it is hidden. Open them at 1440 by 1120.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

interface Args {
  readonly mode: 'light' | 'dark';
}

function WoreOff({ mode }: Args) {
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
      const [[target], [caster]] = await Promise.all([api.acts(thread, 43, 43), api.acts(thread, 42, 42)]);
      if (!target || !caster?.character) return;
      (api as Fake).seed.card(caster.character, target.id, 'whodunnit', { layer: 1, live: true, config: {}, message: 'Who wrote this?', ends: new Date(Date.now() - 2 * 86_400_000).toISOString() });
      if (live) setSeeded(thread);
    })();
    return () => { live = false; };
  }, [api, thread]);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof WoreOff> = {
  title: 'Boards/22 Whodunnit',
  component: WoreOff,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { mode: 'light' },
};
export default meta;

type Story = StoryObj<typeof WoreOff>;

export const WoreOffLight: Story = { args: { mode: 'light' } };
export const WoreOffDark: Story = { args: { mode: 'dark' } };
