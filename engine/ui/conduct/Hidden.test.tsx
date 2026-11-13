/**
 * The hidden note (docs/plans/2026-11-02-conduct-plan.md, Task 6; the boards in docs/research/2026-11-02-conduct/): one calm strip in place of a hidden version's words, in a post, in
 * a History row and inside a quote's frame. A hidden version's words reach no one but its author, who sees them under the note, with Edit, while the version is hidden until they
 * edit it; after a second hide until edited and their edit, they read that an admin will look at the edit.
 *
 * The poison: a hidden post whose words reach the DOM for a non-author. The thread is handed an Act that says it is hidden and still carries the words (a server that forgot to empty
 * them), and the page must draw the note and never the words, since a version's words are drawn by its `hidden` flag and not by whether a body happens to be there.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { Act, ThreadListener } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { LoadedThread } from '../loaded.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';

const NOTE = 'Hidden by an admin: it broke the code of conduct.';
const WORDS = 'the words that must reach no one else';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const theirs = fake.seed.post(thread, spritey, WORDS);
  const mine = fake.seed.post(thread, pipe, `${WORDS}, from me`);
  fake.signInAs(me);
  return { fake, me, other, pipe, spritey, thread, first, theirs, mine };
}
type World = ReturnType<typeof world>;
const open = (w: World) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
const article = (seq: number) => screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });

/** Capture the thread's live listener so a test can deliver an Act as the server would. */
function tap(fake: Fake) {
  let listener: ThreadListener | undefined;
  const real = fake.subscribeThread.bind(fake);
  fake.subscribeThread = (t, l) => { listener = l; return real(t, l); };
  return () => listener!;
}

describe('a hidden post', () => {
  test('shows the note in place of the words, and keeps the postbit, the author, the date and the footer', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    open(w);
    const art = await article(2);
    const note = within(art).getByRole('note');
    expect(note).toHaveTextContent(NOTE);
    expect(note.closest('.kb-act-main')).not.toBeNull();
    expect(within(note).getByRole('link', { name: 'Read the code' })).toHaveAttribute('href', '/conduct');
    expect(art).not.toHaveTextContent(WORDS);
    expect(within(art).getByRole('group', { name: 'About Spritey' })).toBeInTheDocument();
    expect(art.querySelector('time')).not.toBeNull();
    expect(within(art).getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(within(art).getByRole('button', { name: 'Quote' })).toBeInTheDocument();
  });

  test('a post that shows has no note', async () => {
    open(world());
    const art = await article(2);
    expect(within(art).queryByRole('note')).toBeNull();
    expect(art).toHaveTextContent(WORDS);
  });

  test('POISON: a hidden Act that still carries its words never draws them for a non-author', async () => {
    const w = world();
    const tapped = tap(w.fake);
    open(w);
    await article(2);
    const original = (await w.fake.acts(w.thread, 2, 2))[0]!;
    const leaked: Act = { ...original, hidden: true, payload: { body: WORDS }, currentPayload: { body: WORDS } };
    /* The page subscribes in an effect after its first posts are drawn: wait for the listener before speaking to it. */
    await waitFor(() => expect(tapped()).toBeDefined());
    act(() => { tapped().onAct?.(leaked); });
    await waitFor(() => expect(within(document.getElementById('post-2')!).getByRole('note')).toHaveTextContent(NOTE));
    expect(document.getElementById('post-2')).not.toHaveTextContent(WORDS);
  });

  test('never asks for anyone\'s words but its own author\'s: a reader who does not play the post\'s mask makes no read', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hideUntilEdited');
    const asked = vi.spyOn(w.fake, 'myHiddenVersion');
    open(w);
    await article(2);
    await screen.findByRole('article', { name: /^Post 3 /u });
    expect(asked).not.toHaveBeenCalledWith(w.theirs);
  });

  test('has no axe violations', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    open(w);
    expect(describeViolations(await axeViolations(await article(2)))).toBe('');
  });
});

describe('a hidden version in History', () => {
  test('the row shows the one-line note instead of its words and offers no Report to admins; the other rows keep theirs', async () => {
    const w = world();
    w.fake.signInAs(w.other);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.theirs, w.spritey, 'first fix');
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.theirs, w.spritey, 'second fix');
    w.fake.signInAs(w.me);
    w.fake.seed.hide((await w.fake.history(w.theirs))[1]!.id, 'hide');
    open(w);
    const art = await article(2);
    await userEvent.click(within(art).getByRole('button', { name: 'History' }));
    const list = await within(art).findByRole('list', { name: 'Versions of this post, oldest first' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByRole('note')).toHaveTextContent(NOTE);
    expect(within(rows[1]!).queryByRole('button')).toBeNull();
    expect(rows[1]).not.toHaveTextContent('first fix');
    expect(within(rows[0]!).getByRole('button', { name: 'Report to admins: post #2, original' })).toBeInTheDocument();
    expect(within(rows[2]!).getByRole('button', { name: 'Report to admins: post #2, edit 2' })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('second fix');
  });

  test('a hidden original is the note too, whatever the post shows now', async () => {
    const w = world();
    w.fake.signInAs(w.other);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.theirs, w.spritey, 'a fix');
    w.fake.signInAs(w.me);
    w.fake.seed.hide(w.theirs, 'hide');
    open(w);
    const art = await article(2);
    await userEvent.click(within(art).getByRole('button', { name: 'History' }));
    const rows = within(await within(art).findByRole('list', { name: 'Versions of this post, oldest first' })).getAllByRole('listitem');
    expect(within(rows[0]!).getByRole('note')).toHaveTextContent(NOTE);
    expect(rows[0]).not.toHaveTextContent(WORDS);
  });
});

describe('a quote of a hidden version', () => {
  test('shows the note inside the quote\'s frame and keeps the cite and its links', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    const quoting = w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]I answer that.`);
    expect(quoting).toBeDefined();
    open(w);
    const art = await article(4);
    const quote = art.querySelector('blockquote.kb-quote') as HTMLElement;
    expect(quote).not.toBeNull();
    expect(await within(quote.querySelector('.kb-quote-body') as HTMLElement).findByRole('note')).toHaveTextContent(NOTE);
    expect(within(quote.querySelector('cite') as HTMLElement).getByRole('link', { name: 'Post #2' })).toBeInTheDocument();
    expect(art).not.toHaveTextContent(WORDS);
    expect(art).toHaveTextContent('I answer that.');
  });

  test('a quote of a post with an older version hidden shows the note too, though the post itself shows', async () => {
    const w = world();
    w.fake.signInAs(w.other);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.theirs, w.spritey, 'a fix');
    w.fake.signInAs(w.me);
    w.fake.seed.hide(w.theirs, 'hide');
    w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]I answer that.`);
    open(w);
    const art = await article(4);
    expect(await within(art.querySelector('.kb-quote-body') as HTMLElement).findByRole('note')).toHaveTextContent(NOTE);
    expect(await article(2)).not.toHaveTextContent(NOTE.slice(0, 6));
  });

  test('an empty quote a player typed by hand, of a post that is not hidden, is drawn as an empty quote and never claims an admin hid it', async () => {
    const w = world();
    w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}][/quote]Nothing quoted.`);
    open(w);
    const art = await article(4);
    expect(art.querySelector('blockquote.kb-quote')).not.toBeNull();
    await waitFor(() => expect(art.querySelector('cite a, cite')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(within(art).queryByRole('note')).toBeNull();
  });

  test('a quote of a post that shows is drawn as it was', async () => {
    const w = world();
    w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]I answer that.`);
    open(w);
    const art = await article(4);
    expect(within(art).queryByRole('note')).toBeNull();
    expect(art.querySelector('.kb-quote-body')).toHaveTextContent(WORDS);
  });
});

describe('a post that quotes a hidden post, before the conceal job has written its layer', () => {
  const CONCEALING = 'Part of this post quotes a post an admin hid. It will show again in a moment.';

  test('shows the plain note in place of its words, which is not the hidden note, and none of the hidden words', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    const quoting = w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]I answer that.`);
    w.fake.seed.concealing(quoting);
    open(w);
    const art = await article(4);
    const note = within(art).getByRole('note');
    expect(note).toHaveTextContent(CONCEALING);
    expect(note).not.toHaveTextContent(NOTE);
    expect(art).not.toHaveTextContent(WORDS);
    expect(art).not.toHaveTextContent('I answer that.');
    expect(within(art).getByRole('group', { name: 'About Pipewrench' })).toBeInTheDocument();
    expect(within(art).getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  test('shows the words, with the hidden quote emptied, once the job has run (the note ends by itself)', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    const quoting = w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]I answer that.`);
    w.fake.seed.concealing(quoting);
    w.fake.seed.concealed(quoting);
    open(w);
    const art = await article(4);
    expect(within(art).queryByText(CONCEALING)).toBeNull();
    expect(art).toHaveTextContent('I answer that.');
    expect(art).not.toHaveTextContent(WORDS);
  });

  test('POISON: a withheld Act that still carries a body never draws it', async () => {
    const w = world();
    const tapped = tap(w.fake);
    open(w);
    await article(2);
    const original = (await w.fake.acts(w.thread, 2, 2))[0]!;
    const leaked: Act = { ...original, concealing: true, payload: { body: WORDS }, currentPayload: { body: WORDS } };
    /* The page subscribes in an effect after its first posts are drawn: wait for the listener before speaking to it. */
    await waitFor(() => expect(tapped()).toBeDefined());
    act(() => { tapped().onAct?.(leaked); });
    await waitFor(() => expect(within(document.getElementById('post-2')!).getByRole('note')).toHaveTextContent(CONCEALING));
    expect(document.getElementById('post-2')).not.toHaveTextContent(WORDS);
  });

  test('an edit that is withheld is the plain note in History, and the original beside it keeps its words', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    const edit = w.fake.seed.edit(w.mine, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]now`, { at: Date.now() + 10 * 60_000 });
    w.fake.seed.concealing(edit);
    open(w);
    const art = await article(3);
    expect(within(art).getByRole('note')).toHaveTextContent(CONCEALING);
    await userEvent.click(within(art).getByRole('button', { name: 'History' }));
    const rows = within(await within(art).findByRole('list', { name: 'Versions of this post, oldest first' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(`${WORDS}, from me`);
    expect(within(rows[1]!).getByRole('note')).toHaveTextContent(CONCEALING);
    expect(within(rows[1]!).queryByText(NOTE)).toBeNull();
  });

  test('an original that quotes a hidden post, under a current edit that does not, is the plain note in History, never "hidden by an admin"', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    const quoting = w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]I answer that.`);
    w.fake.seed.concealing(quoting);
    w.fake.seed.edit(quoting, w.pipe, 'a clean rewrite', { at: Date.now() + 10 * 60_000 });
    open(w);
    const art = await article(4);
    await userEvent.click(within(art).getByRole('button', { name: 'History' }));
    const rows = within(await within(art).findByRole('list', { name: 'Versions of this post, oldest first' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('note')).toHaveTextContent(CONCEALING);
    expect(within(rows[0]!).queryByText(NOTE)).toBeNull();
    expect(rows[1]).toHaveTextContent('a clean rewrite');
  });

  test('has no axe violations', async () => {
    const w = world();
    w.fake.seed.hide(w.theirs, 'hide');
    const quoting = w.fake.seed.post(w.thread, w.pipe, `[quote=${w.theirs}]${WORDS}[/quote]I answer that.`);
    w.fake.seed.concealing(quoting);
    open(w);
    expect(describeViolations(await axeViolations(await article(4)))).toBe('');
  });
});

describe('the author of a version hidden until they edit it', () => {
  test('sees their own words under the note, "Only you see this", with Edit, which opens the editor on those words', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'hideUntilEdited');
    open(w);
    const art = await article(3);
    const own = await within(art).findByText('Only you see this');
    const panel = own.closest('.kb-hidden-own') as HTMLElement;
    expect(within(art).getByRole('note')).toHaveTextContent(NOTE);
    expect(panel).toHaveTextContent(`${WORDS}, from me`);
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit' }));
    expect(await within(art).findByRole('textbox')).toHaveValue(`${WORDS}, from me`);
  });

  test('the edit is saved as the post\'s own edit', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'hideUntilEdited');
    const edit = vi.spyOn(w.fake, 'edit');
    open(w);
    const art = await article(3);
    const panel = (await within(art).findByText('Only you see this')).closest('.kb-hidden-own') as HTMLElement;
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit' }));
    const box = await within(art).findByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'kinder words');
    await userEvent.click(within(art).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith(w.mine, w.pipe, 'kinder words'));
  });

  test('after a second hide and their edit reads that an admin will look at the edit, and no words', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'waiting');
    open(w);
    const art = await article(3);
    expect(await within(art).findByText('You edited this post. An admin will look at your edit before it shows again.')).toBeInTheDocument();
    expect(within(art).getByRole('note')).toHaveTextContent(NOTE);
    expect(art).not.toHaveTextContent(WORDS);
    expect(within(art).queryByText('Only you see this')).toBeNull();
  });

  test('a version an admin hid outright shows its author the note and nothing more', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'hide');
    open(w);
    const art = await article(3);
    expect(within(art).getByRole('note')).toHaveTextContent(NOTE);
    await waitFor(() => expect(within(art).queryByText('Only you see this')).toBeNull());
    expect(art).not.toHaveTextContent(WORDS);
  });

  test('has no axe violations', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'hideUntilEdited');
    open(w);
    const art = await article(3);
    await within(art).findByText('Only you see this');
    expect(describeViolations(await axeViolations(art))).toBe('');
  });
});

describe('Edit on a hidden post of the reader\'s own', () => {
  const footer = (art: HTMLElement) => art.querySelector('.kb-act-links') as HTMLElement;

  test('the footer offers no Edit while the author\'s words are not read, nor for a post an admin hid outright', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'hide');
    open(w);
    const art = await article(3);
    await waitFor(() => expect(art).toHaveTextContent(NOTE));
    await new Promise((r) => setTimeout(r, 30));
    expect(within(footer(art)).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  test('no Edit shows until the words arrive, and then the footer\'s Edit opens the editor already filled, never blank', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'hideUntilEdited');
    let release!: () => void;
    const real = w.fake.myHiddenVersion.bind(w.fake);
    vi.spyOn(w.fake, 'myHiddenVersion').mockImplementation((...a) => new Promise((resolve) => { release = () => resolve(real(...a)); }));
    open(w);
    const art = await article(3);
    await waitFor(() => expect(art).toHaveTextContent(NOTE));
    expect(within(footer(art)).queryByRole('button', { name: 'Edit' })).toBeNull();
    release();
    await userEvent.click(await within(footer(art)).findByRole('button', { name: 'Edit' }));
    expect(await within(art).findByRole('textbox')).toHaveValue(`${WORDS}, from me`);
  });

  test('an edit whose answer was lost, and which an admin\'s second hide then holds, is still found in History and not offered again', async () => {
    const w = world();
    w.fake.seed.hide(w.mine, 'hideUntilEdited');
    const real = w.fake.edit.bind(w.fake);
    vi.spyOn(w.fake, 'edit').mockImplementation(async (...a) => {
      await real(...a);
      const latest = (await w.fake.history(w.mine)).at(-1)!;
      w.fake.seed.hide(latest.id, 'waiting');
      return { ok: false, error: 'No answer came back.', uncertain: true };
    });
    open(w);
    const art = await article(3);
    await userEvent.click(await within(footer(art)).findByRole('button', { name: 'Edit' }));
    const box = await within(art).findByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'softer words');
    await userEvent.click(within(art).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(art).queryByRole('textbox')).toBeNull());
    expect(within(art).queryByRole('button', { name: 'Save again anyway' })).toBeNull();
  });
});

