/**
 * Report to admins and the hidden note (the conduct plan, Task 6), drawn from the boards in docs/research/2026-11-02-conduct/ for the owner to see in review and for the composition
 * root's axe sweep (web/a11y.test.tsx): the plain link at the foot of a post's Lens and in its History, the dialog in each state, and the note in a post, a History row and a quote,
 * with the author's own view. Each story opens what it shows as a player does.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { userEvent, within } from 'storybook/test';
import type { Instance } from '../../rules/types.ts';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { LoadedThread } from '../loaded.tsx';
import type { World } from '../story.tsx';

/** The screen for the thread of a story's world with this title: a story cannot know the id its world gives it. */
function ThreadTitled({ title }: { readonly title: string }) {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 200 })).threads.find((t) => t.title === title);
        if (found) { setId(found.id); return; }
      }
    })();
  }, [api, title]);
  return id ? <LoadedThread thread={id} /> : <div aria-busy="true" />;
}

const meta: Meta<typeof ThreadTitled> = { title: 'Conduct/Report', component: ThreadTitled };
export default meta;
type Story = StoryObj<typeof ThreadTitled>;

const T0 = Date.UTC(2026, 10, 9, 12);
const MIN = 60_000;
const TITLE = 'Who keeps reacting Salty to my Promos?';

/** A thread of three posts: the reader's own mask Pipewrench, Gravy Knight (post 2, whose words are what is reported or hidden) and Spritey. */
const cast = (fake: Fake, instance: Instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key, { at: T0 });
  const otherAccount = fake.seed.account('story-other');
  const gravy = fake.seed.character(otherAccount, 'Gravy Knight', (instance.classes[1] ?? instance.classes[0]!).key, { at: T0 });
  const spritey = fake.seed.character(fake.seed.account('story-third'), 'Spritey', instance.classes[0]!.key, { at: T0 });
  fake.signInAs(me);
  const general = instance.boards.find((b) => !b.system)!.slug;
  const t = fake.seed.thread(general, spritey, TITLE, 'Three promos this week. Three Salty reactions each. I want names.', { at: T0 + MIN });
  const second = fake.seed.post(t.thread, gravy, 'Receipts: the cape pun landed about as well as your last title shot.', { at: T0 + 2 * MIN });
  const mineAct = fake.seed.post(t.thread, mine, 'Bold words from a mask who has been Salty since the day the board opened.', { at: T0 + 3 * MIN });
  return { me, mine, gravy, spritey, t, second, mineAct };
};

const plain: World = (fake, instance) => { cast(fake, instance); };

/** Presses "Report" on Gravy Knight's post, which opens its Lens on the board's report form (with Report to admins at its foot). */
const openLens = async (canvasElement: HTMLElement) => {
  const post = await within(canvasElement).findByRole('article', { name: /^Post 2 /u });
  await userEvent.click(await within(post).findByRole('button', { name: 'Report' }));
  return within(document.body).findByRole('dialog', { name: 'Report this post' });
};
const openDialog = async (canvasElement: HTMLElement) => {
  const lens = await openLens(canvasElement);
  await userEvent.click(within(lens).getByRole('button', { name: 'Report to admins' }));
  return within(document.body).findByRole('dialog', { name: 'Report to admins' });
};
const choose = async (dialog: HTMLElement) => {
  await userEvent.click(within(dialog).getAllByRole('radio')[0]!);
  await userEvent.type(within(dialog).getByRole('textbox'), 'The last line goes after their real job, not their character.');
};
const send = (dialog: HTMLElement) => userEvent.click(within(dialog.querySelector('.kb-glass-form-foot') as HTMLElement).getByRole('button', { name: 'Send to admins' }));

/** The plain link at the foot of the Lens, under its rule. */
export const LensFoot: Story = { args: { title: TITLE }, parameters: { world: plain, path: '/t/x' }, play: async ({ canvasElement }) => { await openLens(canvasElement); } };

/** The dialog, form state: a section chosen, a note typed with its live count. */
export const DialogForm: Story = {
  args: { title: TITLE },
  parameters: { world: plain, path: '/t/x' },
  play: async ({ canvasElement }) => { await choose(await openDialog(canvasElement)); },
};

export const DialogSent: Story = {
  args: { title: TITLE },
  parameters: { world: plain, path: '/t/x' },
  play: async ({ canvasElement }) => { const d = await openDialog(canvasElement); await choose(d); await send(d); await within(d).findByText(/^Sent\./u); },
};

/** The open-report limit, shown in place of the form with the account's own count: the dialog reads the count as it opens and says the limit at once, so there is no form to fill. (A limit that arrives at send time is held by Report.test.tsx.) */
export const DialogLimit: Story = {
  args: { title: TITLE },
  parameters: {
    world: ((fake, instance) => {
      const w = cast(fake, instance);
      for (let i = 0; i < 3; i++) fake.seed.conductReport({ version: w.mineAct, section: 'hate', reporter: w.me });
    }) satisfies World,
    path: '/t/x',
  },
  play: async ({ canvasElement }) => { const d = await openDialog(canvasElement); await within(d).findByText(/^You have 3 reports/u); },
};

/** An error, said plainly above the form, which keeps what was typed: the answer to the send was lost. */
export const DialogError: Story = {
  args: { title: TITLE },
  parameters: { world: ((fake, instance) => { cast(fake, instance); fake.seed.loseNextAnswer(false); }) satisfies World, path: '/t/x' },
  play: async ({ canvasElement }) => { const d = await openDialog(canvasElement); await choose(d); await send(d); await within(d).findByRole('alert'); },
};

/** A post's History with three versions: the original and the current one carry the plain link; the middle one, hidden, is the note and carries none. */
export const HistoryWithAHiddenVersion: Story = {
  args: { title: TITLE },
  parameters: {
    world: ((fake, instance) => {
      const w = cast(fake, instance);
      fake.seed.hide(fake.seed.edit(w.second, w.gravy, 'Receipts: the cape pun landed about as well as your last title shot, and you know it.', { at: T0 + 10 * MIN }), 'hide');
      fake.seed.edit(w.second, w.gravy, 'Receipts: the cape pun was fine. The pause after it was a crime against timing.', { at: T0 + 20 * MIN });
    }) satisfies World,
    path: '/t/x',
  },
  play: async ({ canvasElement }) => {
    const post = await within(canvasElement).findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(await within(post).findByRole('button', { name: 'History' }));
    await within(post).findByRole('list', { name: 'Versions of this post, oldest first' });
  },
};

/** A hidden post: the note in place of the words; the postbit, the line and the footer stay. */
export const HiddenPost: Story = {
  args: { title: TITLE },
  parameters: { world: ((fake, instance) => { const w = cast(fake, instance); fake.seed.hide(w.second, 'hide'); }) satisfies World, path: '/t/x' },
};

/** A quote of a hidden post: the note inside the quote's frame, its cite kept. */
export const QuoteOfAHiddenPost: Story = {
  args: { title: TITLE },
  parameters: {
    world: ((fake, instance) => {
      const w = cast(fake, instance);
      fake.seed.hide(w.second, 'hide');
      fake.seed.post(w.t.thread, w.spritey, `[quote=${w.second}]Receipts: the cape pun.[/quote]I will say it where everyone can see it: the pause was still the funniest part of the week.`, { at: T0 + 4 * MIN });
    }) satisfies World,
    path: '/t/x',
  },
};

/** The author's own view of a post hidden until they edit it: the note, then "Only you see this" with their words and Edit. */
export const AuthorHiddenUntilEdited: Story = {
  args: { title: TITLE },
  parameters: { world: ((fake, instance) => { const w = cast(fake, instance); fake.seed.hide(w.mineAct, 'hideUntilEdited'); }) satisfies World, path: '/t/x' },
};

/** The author's view after a second hide until edited and their edit: the one line that an admin will look at it. */
export const AuthorWaiting: Story = {
  args: { title: TITLE },
  parameters: { world: ((fake, instance) => { const w = cast(fake, instance); fake.seed.hide(w.mineAct, 'waiting'); }) satisfies World, path: '/t/x' },
};
