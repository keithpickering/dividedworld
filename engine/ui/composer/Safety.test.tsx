/**
 * What keeps a writer from losing words or posting twice: an answer that never came back, focus
 * and announcement after a post lands, a draft shared by two tabs, and a box keyed to its thread.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOST_ANSWER, type Id } from '../data/api.ts';
import { renderIn } from '../test-world.tsx';
import { Composer } from './Composer.tsx';
import { openThread, replyBox, threadWorld } from './support.tsx';

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(document, 'execCommand'); });

const say = async (text: string) => {
  const box = await replyBox();
  await userEvent.click(box);
  await userEvent.paste(text);
  return box;
};
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const live = () => document.querySelector('.kb-thread [aria-live="polite"]')!;

describe('an answer that never came back', () => {
  test('a reply that did go through is found in the thread: the draft is cleared and the post shown, nothing is sent twice', async () => {
    const w = threadWorld();
    const sent = vi.spyOn(w.fake, 'post');
    openThread(w);
    const box = await say('It went through.');
    w.fake.seed.loseNextAnswer(true);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(post(3)).toHaveTextContent('It went through.'));
    expect(box).toHaveValue('');
    expect(localStorage.getItem(`kb-draft:${w.me}:${w.thread}`)).toBeNull();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send again anyway' })).toBeNull();
  });

  test('a reply that did not go through keeps the draft and the next press asks to send again anyway', async () => {
    const w = threadWorld();
    const sent = vi.spyOn(w.fake, 'post');
    openThread(w);
    const box = await say('It did not.');
    w.fake.seed.loseNextAnswer(false);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(LOST_ANSWER);
    expect(screen.getByRole('alert')).toHaveTextContent(/not in the thread/u);
    expect(box).toHaveValue('It did not.');
    expect(post(3)).toBeNull();
    const again = screen.getByRole('button', { name: 'Send again anyway' });
    expect(again).toBeEnabled();
    await userEvent.click(again);
    await waitFor(() => expect(post(3)).toHaveTextContent('It did not.'));
    expect(sent).toHaveBeenCalledTimes(2);
    expect(box).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  test('a call that threw is treated the same way, and its words never invite a plain resend', async () => {
    const w = threadWorld();
    vi.spyOn(w.fake, 'post').mockRejectedValueOnce(new Error('network'));
    openThread(w);
    await say('Thrown.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/try again\b/iu);
    expect(await screen.findByRole('button', { name: 'Send again anyway' })).toBeInTheDocument();
  });

  test('changing the words clears the confirmation: a different message is a plain Send', async () => {
    const w = threadWorld();
    openThread(w);
    await say('First try.');
    w.fake.seed.loseNextAnswer(false);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('button', { name: 'Send again anyway' });
    await userEvent.type(await replyBox(), ' More.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  test('an edit that was saved is found in the history: the form closes; one that was not asks again', async () => {
    const w = threadWorld(3);
    const edit = vi.spyOn(w.fake, 'edit');
    openThread(w);
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const box = within(mine).getByRole('textbox', { name: 'Your edit' });
    await userEvent.type(box, ' (fixed)');
    w.fake.seed.loseNextAnswer(false);
    await userEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    expect(await within(mine).findByRole('alert')).toHaveTextContent(LOST_ANSWER);
    expect(box).toHaveValue('post 2 (fixed)');
    w.fake.seed.loseNextAnswer(true);
    await userEvent.click(within(mine).getByRole('button', { name: 'Save again anyway' }));
    await waitFor(() => expect(mine.querySelector('form')).toBeNull());
    expect(mine).toHaveTextContent('post 2 (fixed)');
    /* The second press was lost after it went through: it was found, not sent a third time. */
    expect(edit).toHaveBeenCalledTimes(2);
    expect((await w.fake.history(w.ids[1]!)).map((v) => v.currentPayload.body)).toEqual(['post 2', 'post 2 (fixed)']);
    expect(within(mine).getByRole('button', { name: 'Edit' })).toHaveFocus();
  });
});

describe('after a reply lands', () => {
  test('focus goes to the new post and the thread\'s polite region says "Reply posted"', async () => {
    const w = threadWorld();
    openThread(w);
    await say('Landing.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(post(3)).toHaveTextContent('Landing.'));
    await waitFor(() => expect(document.activeElement).toBe(post(3)));
    expect(live()).toHaveTextContent('Reply posted');
    expect(live()).not.toHaveTextContent('New post by Pipewrench');
  });

  test('a saved edit returns focus to that post\'s Edit button', async () => {
    const w = threadWorld(3);
    openThread(w);
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    await userEvent.type(within(mine).getByRole('textbox', { name: 'Your edit' }), '!');
    await userEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mine.querySelector('form')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(mine).getByRole('button', { name: 'Edit' })));
  });
});

describe('a box that is kept for one account and thread', () => {
  function Switch({ a, b }: { a: Id; b: Id }) {
    const [thread, setThread] = useState(a);
    return (
      <>
        <button type="button" onClick={() => setThread(b)}>go to the other thread</button>
        <Composer thread={thread} latest={null} since={() => 0} onPosted={() => undefined} />
      </>
    );
  }

  test('when the thread changes without a remount, the words and the mask do not carry over to be written under the new thread', async () => {
    const w = threadWorld();
    const other = w.fake.seed.thread('general', w.spritey, 'Another thread', 'hello');
    renderIn(w.fake, <Switch a={w.thread} b={other.thread} />);
    const box = await replyBox();
    await userEvent.click(box);
    await userEvent.paste('Meant for the first thread.');
    await userEvent.click(screen.getByRole('button', { name: 'go to the other thread' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Your reply' })).toHaveValue(''));
    expect(JSON.parse(localStorage.getItem(`kb-draft:${w.me}:${w.thread}`)!).text).toBe('Meant for the first thread.');
    expect(localStorage.getItem(`kb-draft:${w.me}:${other.thread}`)).toBeNull();
  });

  test('signed in with no account open, a plain note stands where the box would be', async () => {
    const w = threadWorld();
    vi.spyOn(w.fake, 'session').mockResolvedValue({ signedIn: true, account: null });
    openThread(w);
    expect(await screen.findByText(/account is not open yet/u)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
  });
});

describe('words typed while a send is in flight, and a second tab', () => {
  test('success clears the draft only if the box still holds what was sent', async () => {
    const w = threadWorld();
    let release!: () => void;
    const real = w.fake.post.bind(w.fake);
    vi.spyOn(w.fake, 'post').mockImplementation(async (...a) => { await new Promise<void>((r) => { release = r; }); return real(...a); });
    openThread(w);
    const box = await say('Sent words');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(release).toBeDefined());
    await userEvent.type(box, ' and then more');
    await act(async () => { release(); });
    await waitFor(() => expect(post(3)).toHaveTextContent('Sent words'));
    expect(box).toHaveValue('Sent words and then more');
    expect(JSON.parse(localStorage.getItem(`kb-draft:${w.me}:${w.thread}`)!).text).toBe('Sent words and then more');
  });

  test('a change to the draft in another tab is adopted, and a cleared one clears the box', async () => {
    const w = threadWorld();
    openThread(w);
    const box = await replyBox();
    const key = `kb-draft:${w.me}:${w.thread}`;
    localStorage.setItem(key, JSON.stringify({ text: 'Typed in the other tab', as: w.pipe }));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key, newValue: localStorage.getItem(key) })); });
    await waitFor(() => expect(box).toHaveValue('Typed in the other tab'));
    localStorage.removeItem(key);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key, newValue: null })); });
    await waitFor(() => expect(box).toHaveValue(''));
    /* Another key is none of this box's business. */
    await userEvent.type(box, 'mine');
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'kb-draft:someone:else', newValue: null })); });
    expect(box).toHaveValue('mine');
  });

  test('signing out clears the account\'s drafts and no one else\'s', async () => {
    const w = threadWorld();
    localStorage.setItem(`kb-draft:${w.me}:t1`, JSON.stringify({ text: 'mine', as: null }));
    localStorage.setItem(`kb-draft:${w.other}:t1`, JSON.stringify({ text: 'theirs', as: null }));
    openThread(w);
    await replyBox();
    await act(async () => { await w.fake.signOut(); });
    await waitFor(() => expect(localStorage.getItem(`kb-draft:${w.me}:t1`)).toBeNull());
    expect(localStorage.getItem(`kb-draft:${w.me}:${w.thread}`)).toBeNull();
    expect(localStorage.getItem(`kb-draft:${w.other}:t1`)).not.toBeNull();
  });
});

describe('quoting a long post', () => {
  test('inserts the whole post, and says plainly beside the count that the draft is now too long to send', async () => {
    const w = threadWorld(2, { postMaxLength: 20_000 });
    const long = 'x'.repeat(20_000);
    w.fake.seed.post(w.thread, w.spritey, long);
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 3 /u });
    await userEvent.click(within(article).getByRole('button', { name: 'Quote' }));
    const box = await replyBox();
    expect((box as HTMLTextAreaElement).value).toContain(long);
    const foot = box.closest('.kb-editor')!.querySelector('.kb-editor-foot')!;
    expect(foot).toHaveTextContent(/over/u);
    expect(foot).toHaveTextContent(/quote.*too long to send/iu);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.clear(box);
    expect(foot).not.toHaveTextContent(/too long to send/u);
  });
});

describe('the box', () => {
  test('says Ctrl+Enter sends, and Esc cancels an edit as it closes a spin form', async () => {
    const w = threadWorld(3);
    openThread(w);
    expect(await screen.findByText(/Ctrl\+Enter/u)).toBeInTheDocument();
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    expect(within(mine).getByText(/Ctrl\+Enter/u)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(mine.querySelector('form')).toBeNull();
    expect(within(mine).getByRole('button', { name: 'Edit' })).toHaveFocus();
  });

  test('keeps an empty status region mounted, and fills it when the character is swapped mid-draft', async () => {
    const w = threadWorld();
    openThread(w);
    const form = (await replyBox()).closest('form')!;
    const region = form.querySelector('[role="status"]')!;
    expect(region).toBeEmptyDOMElement();
    await say('Hello');
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(region).toHaveTextContent(/now posting as Zed/u));
    expect(form.querySelector('[role="status"]')).toBe(region);
  });

  test('a toolbar press goes through the browser\'s own insertion (so undo keeps working), falling back to state where there is none', async () => {
    const w = threadWorld();
    const exec = vi.fn((_command: string, _ui?: boolean, value?: string) => {
      const el = document.activeElement as HTMLTextAreaElement;
      el.setRangeText(value ?? '', el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value ?? '' }));
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    openThread(w);
    const box = (await say('make this loud')) as HTMLTextAreaElement;
    box.setSelectionRange(5, 9);
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(exec).toHaveBeenCalledWith('insertText', false, '[b]this[/b]');
    expect(box).toHaveValue('make [b]this[/b] loud');
    expect(box.selectionStart).toBe('make [b]'.length);
    expect(box.selectionEnd).toBe('make [b]this'.length);
    /* The same text reached the draft: state followed the input event. */
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`kb-draft:${w.me}:${w.thread}`)!).text).toBe('make [b]this[/b] loud'));
    /* Where it declines, the text still changes. */
    exec.mockReturnValueOnce(false);
    box.setSelectionRange(0, 4);
    await userEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(box).toHaveValue('[i]make[/i] [b]this[/b] loud');
    fireEvent.change(box, { target: { value: 'x' } });
  });
});

describe('a board that could not be read', () => {
  test('shows neither the reply box nor the System\'s note, but a plain line with Try again', async () => {
    const w = threadWorld();
    const real = w.fake.board.bind(w.fake);
    const failing = vi.spyOn(w.fake, 'board').mockRejectedValue(new Error('down'));
    openThread(w);
    await screen.findByRole('article', { name: /^Post 1 /u });
    expect(await screen.findByText(/could not be read, so the reply box is left out/u)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
    expect(screen.queryByText(/Replies here are spins/u)).toBeNull();
    failing.mockImplementation(real);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await replyBox()).toBeInTheDocument();
    expect(screen.queryByText(/left out/u)).toBeNull();
  });
});
