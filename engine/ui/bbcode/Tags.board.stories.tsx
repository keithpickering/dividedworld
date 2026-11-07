/**
 * The BBCode tags' board (the BBCode plan, Task 12): one thread whose posts use every tag the plan added, drawn by the thread's own
 * screen as the route /t/:thread draws it, signed in as the player, so the shots for the final review show the tags where they live.
 * The posts, in order: a real quote, a counterfeit of a character who exists (`user=` names her id), a hand-typed counterfeit and a
 * bare one; both spoilers, shut and open; a YouTube box, a Vimeo box and an open player (a file, so nothing is fetched from anywhere);
 * the layout tags; the effect tags; and a post with an address and a `[noparse]`. The last two stories are the composer's: the toolbar
 * with the Quote someone… dialog up, and with a pasted address offered as a video. Their states are reached by the play function (the
 * route renders no play, so the board's a11y run reads the thread, and `docs/research/2026-11-07-bbcode/` holds the shots of all of them).
 * The video is a file at an example address with `preload="none"`, and a YouTube thumbnail is the one fetch a shut box makes.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { userEvent, within } from 'storybook/test';
import { useKayfa } from '../context.tsx';
import { LoadedThread } from '../loaded.tsx';
import type { World } from '../story.tsx';
import { Wobble } from './Wobble.tsx';

const TITLE = 'Every tag, one thread';
const T0 = Date.UTC(2026, 10, 7, 9, 0);
const MIN = 60_000;
const YOUTUBE = 'dQw4w9WgXcQ';

function TagsThread() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null | 'missing'>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === TITLE);
        if (found) { setId(found.id); return; }
      }
      setId('missing');
    })();
  }, [api]);
  if (id === 'missing') return <p role="alert">The story's world has no thread titled "{TITLE}".</p>;
  /* The app frame mounts the wobble filter once (Frame.tsx); a story has no frame, so it mounts its own. */
  return id ? <div><LoadedThread thread={id} /><Wobble /></div> : <div aria-busy="true" />;
}

const world: World = (fake, instance) => {
  const cls = (i: number) => (instance.classes[i] ?? instance.classes[0]!).key;
  const { seed } = fake;
  const player = seed.account('player');
  const rival = seed.account('rival');
  const pipewrench = seed.character(player, 'Pipewrench', cls(0), { at: T0 - 60 * MIN });
  const geno = seed.character(rival, 'Geno', cls(1), { at: T0 - 60 * MIN });
  const boshi = seed.character(rival, 'Boshi', cls(2), { at: T0 - 60 * MIN });
  const board = (instance.boards.find((b) => !b.system) ?? instance.boards[0]!).slug;
  let at = T0;
  const next = () => ({ at: (at += MIN) });
  const opening = seed.thread(board, geno, TITLE, 'I never said the Star Road was closed. Anyone who tells you so is making it up.', { at });
  const said = opening.act;
  const post = (who: string, body: string) => seed.post(opening.thread, who, body, next());

  post(boshi, `[quote=${said}]I never said the Star Road was closed.[/quote]He literally did. [b]Bold[/b], [i]italic[/i], [u]underlined[/u] and [s]struck[/s].`);
  post(boshi, `[quote=Geno user=${geno}]I never said the Star Road was closed.[/quote]Here is what he said, in his own hand.`);
  post(pipewrench, '[quote=Geno]Fine, it was closed on Tuesdays.[/quote]A hand-typed quote names no post at all.');
  post(pipewrench, '[quote]Nobody is quoted here, and nobody says so.[/quote]A bare quote, with no name to forge.');
  post(geno, '[spoiler=The ending]Mario was the Plumber Prince all along.[/spoiler]\n[spoiler]Luigi did not go on the trip.[/spoiler]\nThe [ispoiler]hidden words[/ispoiler] are [ispoiler][b]bold[/b] under the bar[/ispoiler].');
  post(boshi, `[video]https://youtu.be/${YOUTUBE}[/video]\n[video]https://vimeo.com/76979871[/video]\n[video]https://cdn.example.com/clips/star-road.mp4[/video]`);
  post(geno, '[center]Centered[/center]\n[left]Left[/left]\n[right]Right[/right]\n[hr]\nH[sub]2[/sub]O and E = mc[sup]2[/sup]');
  post(pipewrench, '[font=georgia]Georgia[/font], [font=courier new]Courier New[/font], [font=impact]Impact[/font]\n[marquee]The Star Road is open on Wednesdays only.[/marquee]');
  post(boshi, '[glow=red]Red glow[/glow] [shadow=blue]Blue shadow[/shadow] [rainbow]Every color of the Star Road[/rainbow] [highlight=yellow]Highlighted[/highlight] [highlight=navy]On navy[/highlight]');
  post(geno, 'Read it at https://example.com/star-road, then say so (https://example.com/closed).\n[noparse][b]not bold[/b] [video]https://youtu.be/dQw4w9WgXcQ[/video][/noparse]');
  fake.signInAs(player);
};

const meta: Meta<typeof TagsThread> = {
  title: 'Boards/16 BBCode tags',
  component: TagsThread,
  parameters: { world, path: '/t/x', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof TagsThread>;

/** The thread on the Main board's layout, at 1440 wide. */
export const Tags: Story = {};
/** The same thread on the Phone board's layout, at 390 by 844. */
export const TagsPhone: Story = {
  name: 'Tags, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** Shut spoilers opened, the file video playing and the marquee paused. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    for (const b of await c.findAllByRole('button', { name: 'Spoiler' })) await userEvent.click(b);
    await userEvent.click(await c.findByRole('button', { name: 'Play File video' }));
    await userEvent.click(await c.findByRole('button', { name: 'Pause' }));
  },
};
/** The quick reply's toolbar with the Quote someone… dialog up. */
export const QuoteSomeoneDialog: Story = {
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Quote someone…' })); },
};
/** A video address pasted into the reply box, and the offer to embed it. */
export const PasteOffer: Story = {
  play: async ({ canvasElement }) => {
    const box = await within(canvasElement).findByRole('textbox', { name: /reply/iu });
    await userEvent.click(box);
    await userEvent.paste(`https://youtu.be/${YOUTUBE}`);
  },
};
