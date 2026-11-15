/**
 * Hot Box as stories for the owner's word (docs/plans/2026-11-15-hot-box-plan.md, Task 7; design, section 2.2): post #43 of the boards fixture at the
 * Main board's moment (the one post of the page that carries no Whoops! ink over its words, so the smoke's pixels are the only thing over them), under a
 * Hot Box that #42's author played, in hot pink (#ff69b4). The story route renders no play function, so e2e/hot-box.spec.ts moves the pointer and holds the
 * control itself.
 *
 * `FreshLight` and `FreshDark` are the smoke as it lands, at full strength, on the light board and on the dark. `Thinning` is the same post two and a
 * half days in, with half a day left, so the fog has thinned most of the way to its least. `LongPost` gives the post twelve paragraphs with a link in the
 * ninth, which the smoke makes inert until a sweep is held to its end. `Reduced` is the fresh smoke with motion reduced (`data-kb-motion="reduce"`), where
 * nothing drifts and a clearing opens and closes with no steps between. Open them at 1440 by 1120.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import { cardOf } from '../../../../engine/ui/story.tsx';

const DAY = 86_400_000;
/** The smoke's color in every story: hot pink, as hex (the named list `color()` reads has no `hotpink`). */
const COLOR = '#ff69b4';

/** Twelve paragraphs, the ninth with a link in it: long enough that the sweep is a long hold and a reader has to find the link. */
const LONG = Array.from({ length: 12 }, (_, i) => (i === 8
  ? 'Paragraph nine has the link: the full notes are [url=https://example.com/hot-box-notes]on the notes page[/url], which is worth reading before you reply, and it goes on a little so that it takes a line or two.'
  : `Paragraph ${i + 1} of the long post. It runs on for a couple of lines so that the smoke has a good many lines to cover and a reader has a good many to clear, one patch at a time, with the pointer or a finger or a held control.`)).join('\n\n');

interface Args {
  readonly mode: 'light' | 'dark';
  /** Days into the three the smoke lasts. */
  readonly into?: number;
  readonly long?: boolean;
  readonly reduced?: boolean;
}

function Smoked({ mode, into = 0, long = false, reduced = false }: Args) {
  const { api, instance } = useKayfa();
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
    if (!reduced) return;
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    return () => { document.documentElement.removeAttribute('data-kb-motion'); };
  }, [reduced]);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 43, 43), api.acts(thread, 42, 42)]);
      if (!target?.character || !caster?.character) return;
      const fake = api as Fake;
      if (long) fake.seed.edit(target.id, target.character, LONG);
      const now = api.now();
      fake.seed.card(caster.character, target.id, cardOf(instance.cards, 'hot-box').key, {
        layer: 1, live: true, config: { color: COLOR }, message: 'Smoke out', at: now - into * DAY, ends: new Date(now + (3 - into) * DAY).toISOString(),
      });
      if (live) setSeeded(thread);
    })();
    return () => { live = false; };
  }, [api, instance, thread, into, long]);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Smoked> = {
  title: 'Boards/24 Hot Box',
  component: Smoked,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { mode: 'light' },
};
export default meta;

type Story = StoryObj<typeof Smoked>;

export const FreshLight: Story = { args: { mode: 'light' } };
export const FreshDark: Story = { args: { mode: 'dark' } };
export const Thinning: Story = { args: { mode: 'light', into: 2.5 } };
export const LongPost: Story = { args: { mode: 'light', long: true } };
export const Reduced: Story = { args: { mode: 'light', reduced: true } };
