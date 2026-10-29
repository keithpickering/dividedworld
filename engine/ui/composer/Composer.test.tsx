import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openThread, replyBox, threadWorld } from './support.tsx';

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const send = () => screen.getByRole('button', { name: 'Send' });
const say = async (text: string) => {
  const box = await replyBox();
  await userEvent.click(box);
  await userEvent.paste(text);
  return box;
};
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const draftKey = (w: ReturnType<typeof threadWorld>) => `kb-draft:${w.me}:${w.thread}`;

describe('the quick reply', () => {
  test('sits at the foot of the thread and names the HUD\'s character in bold', async () => {
    const w = threadWorld();
    openThread(w);
    const box = await replyBox();
    const form = box.closest('form')!;
    expect(within(form).getByText('Posting as')).toBeInTheDocument();
    expect(within(form).getByText('Pipewrench').tagName).toBe('STRONG');
    const acts = document.querySelector('.kb-acts')!;
    expect(acts.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('is not on a thread of The System\'s board, where a plain note says replies are spins', async () => {
    const w = threadWorld();
    const said = w.fake.seed.thread('the-system', null, 'The tally', 'Settled.');
    openThread({ ...w, thread: said.thread });
    await screen.findByRole('article', { name: /^Post 1 by The System/u });
    expect(screen.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
    expect(screen.getByText(/Replies here are spins/u)).toBeInTheDocument();
  });

  test('sends as the HUD\'s character, clears the box and the kept draft, and the post appears', async () => {
    const w = threadWorld();
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    const box = await say('A fresh reply.');
    expect(JSON.parse(localStorage.getItem(draftKey(w))!).text).toBe('A fresh reply.');
    await userEvent.click(send());
    await waitFor(() => expect(post(3)).toHaveTextContent('A fresh reply.'));
    expect(posted).toHaveBeenCalledWith(w.thread, w.pipe, 'A fresh reply.', null);
    expect(box).toHaveValue('');
    expect(localStorage.getItem(draftKey(w))).toBeNull();
  });

  test('a swap of the HUD\'s character mid-draft blocks the send until it is confirmed', async () => {
    const w = threadWorld();
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    await say('Wrong mask?');
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to Zed' }));
    const notice = await screen.findByText(/now posting as/u);
    expect(notice.closest('[role="status"]')).toHaveTextContent(/now posting as Zed/u);
    expect(notice.closest('[role="status"]')).toHaveTextContent(/Pipewrench/u);
    /* The first press only confirms. */
    await userEvent.click(screen.getByRole('button', { name: /Confirm posting as Zed/u }));
    expect(posted).not.toHaveBeenCalled();
    expect(screen.queryByText(/now posting as/u)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Your reply' })).toHaveValue('Wrong mask?');
    /* The one after sends, as the new character. */
    await userEvent.click(send());
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(posted).toHaveBeenCalledWith(w.thread, w.zed, 'Wrong mask?', null);
  });

  test('swapping back is the other way out of "now posting as"', async () => {
    const w = threadWorld();
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    await say('Hold on.');
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to Zed' }));
    await screen.findByText(/now posting as/u);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Pipewrench' }));
    expect(screen.queryByText(/now posting as/u)).toBeNull();
    await userEvent.click(send());
    await waitFor(() => expect(posted).toHaveBeenCalledWith(w.thread, w.pipe, 'Hold on.', null));
  });

  test('a swap with nothing written says nothing and sends as the new character at once', async () => {
    const w = threadWorld();
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    await replyBox();
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to Zed' }));
    expect(screen.queryByText(/now posting as/u)).toBeNull();
    await userEvent.click(await screen.findByRole('textbox', { name: 'Your reply' }));
    await userEvent.paste('Straight away.');
    await userEvent.click(send());
    await waitFor(() => expect(posted).toHaveBeenCalledWith(w.thread, w.zed, 'Straight away.', null));
  });

  test('keeps the draft per thread on the device, and a thread of its own has its own', async () => {
    const w = threadWorld();
    const view = openThread(w);
    await say('Half a thought');
    view.unmount();
    openThread(w);
    expect(await replyBox()).toHaveValue('Half a thought');
    const other = w.fake.seed.thread('general', w.spritey, 'Another', 'Elsewhere.');
    cleanup();
    openThread({ ...w, thread: other.thread });
    expect(await replyBox()).toHaveValue('');
  });

  test('a draft kept with a character that is no longer the HUD\'s asks before it sends', async () => {
    const w = threadWorld();
    localStorage.setItem(draftKey(w), JSON.stringify({ text: 'From yesterday', as: w.zed }));
    openThread(w);
    expect(await replyBox()).toHaveValue('From yesterday');
    expect(await screen.findByText(/now posting as/u)).toBeInTheDocument();
  });

  test('works without storage: the device keeps nothing and the reply still goes', async () => {
    const w = threadWorld();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    openThread(w);
    await say('No storage here.');
    await userEvent.click(send());
    await waitFor(() => expect(post(3)).toHaveTextContent('No storage here.'));
  });

  test('a refusal is shown in the server\'s words and the draft is kept', async () => {
    const w = threadWorld();
    vi.spyOn(w.fake, 'post').mockResolvedValue({ ok: false, error: 'you are posting too fast' });
    openThread(w);
    const box = await say('Too much.');
    await userEvent.click(send());
    expect(await screen.findByRole('alert')).toHaveTextContent('you are posting too fast');
    expect(box).toHaveValue('Too much.');
    expect(JSON.parse(localStorage.getItem(draftKey(w))!).text).toBe('Too much.');
  });

  test('Send is off while a reply is going, so a double press posts once', async () => {
    const w = threadWorld();
    let release!: () => void;
    const real = w.fake.post.bind(w.fake);
    const posted = vi.spyOn(w.fake, 'post').mockImplementation(async (...a) => { await new Promise<void>((r) => { release = r; }); return real(...a); });
    openThread(w);
    await say('Once.');
    await userEvent.click(send());
    expect(send()).toBeDisabled();
    await userEvent.click(send());
    expect(posted).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await waitFor(() => expect(post(3)).toHaveTextContent('Once.'));
    expect(send()).toBeDisabled();
  });

  test('counts against the longest post, and a draft over it cannot be sent', async () => {
    const w = threadWorld();
    openThread(w);
    await say('12345');
    expect(screen.getByText('5 of 200')).toBeInTheDocument();
    await userEvent.paste('x'.repeat(200));
    expect(screen.getByText(/205 of 200/u)).toBeInTheDocument();
    expect(screen.getByText(/5 over/u)).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  test('a blank draft cannot be sent', async () => {
    const w = threadWorld();
    openThread(w);
    await say('   ');
    expect(send()).toBeDisabled();
  });

  test('with no character able to post, it says so and offers to make one', async () => {
    const w = threadWorld();
    const lone = w.fake.seed.account('lone');
    w.fake.seed.character(lone, 'Waiting', 'face', { debuted: false });
    w.fake.signInAs(lone);
    openThread(w);
    await screen.findByRole('article', { name: /^Post 1 /u });
    expect(await screen.findByRole('link', { name: 'Make a character' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
  });
});

describe('the toolbar', () => {
  const tools = ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Link', 'Image', 'Quote the latest post', 'Code', 'List'];

  test('has a labeled button for each tool, as one stop on the Tab order that the arrow keys move along', async () => {
    const w = threadWorld();
    openThread(w);
    const bar = await screen.findByRole('toolbar', { name: 'Formatting' });
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(tools);
    const stops = within(bar).getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    stops[0]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(bar).getByRole('button', { name: 'Italic' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(bar).getByRole('button', { name: 'List' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(bar).getByRole('button', { name: 'Bold' })).toHaveFocus();
  });

  test('wraps the selection in the box, and puts the cursor inside an empty tag', async () => {
    const w = threadWorld();
    openThread(w);
    const box = (await say('make this loud')) as HTMLTextAreaElement;
    box.setSelectionRange(5, 9);
    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(box).toHaveValue('make [b]this[/b] loud');
    expect(box).toHaveFocus();
    box.setSelectionRange(0, 0);
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(box).toHaveValue('[code][/code]make [b]this[/b] loud');
    expect(box.selectionStart).toBe('[code]'.length);
  });

  test('the Quote tool quotes the latest post of the thread', async () => {
    const w = threadWorld(3);
    openThread(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    await userEvent.click(await screen.findByRole('button', { name: 'Quote the latest post' }));
    expect(await replyBox()).toHaveValue(`[quote=${w.ids[2]}]post 3[/quote]\n`);
  });
});

describe('quoting from a post', () => {
  test('appends the quote to the draft with the post\'s current words and moves focus to the box', async () => {
    const w = threadWorld(3);
    openThread(w);
    await say('I disagree.');
    const target = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(within(target).getByRole('button', { name: 'Quote' }));
    const box = await replyBox();
    expect(box).toHaveValue(`I disagree.\n[quote=${w.ids[1]}]post 2[/quote]\n`);
    expect(box).toHaveFocus();
  });

  test('quotes what an edit made the post say, not what it first said', async () => {
    const w = threadWorld(3);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.ids[1]!, w.pipe, 'post 2, fixed');
    openThread(w);
    const target = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(within(target).getByRole('button', { name: 'Quote' }));
    expect(await replyBox()).toHaveValue(`[quote=${w.ids[1]}]post 2, fixed[/quote]\n`);
  });

  test('a reply that quotes names the quoted Act with the post', async () => {
    const w = threadWorld(3);
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    const target = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(within(target).getByRole('button', { name: 'Quote' }));
    await userEvent.click(send());
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(posted.mock.calls[0]![3]).toBe(w.ids[1]);
    await waitFor(() => expect(post(4)).toHaveTextContent('post 2'));
  });

  test('is not offered where the thread has no composer', async () => {
    const w = threadWorld();
    const said = w.fake.seed.thread('the-system', null, 'The tally', 'Settled.');
    openThread({ ...w, thread: said.thread });
    const article = await screen.findByRole('article', { name: /^Post 1 by The System/u });
    expect(within(article).queryByRole('button', { name: 'Quote' })).toBeNull();
  });
});

describe('the preview', () => {
  test('renders the draft in place with the thread\'s renderer, and equals the post it makes', async () => {
    const w = threadWorld(2);
    openThread(w);
    const draft = `[quote=${w.ids[0]}]post 1[/quote]Fair, but [b]bold[/b], [i]slanted[/i], [url=https://example.com/x]a link[/url] & <b>not markup</b>\n[list]\n[*]one\n[*]two\n[/list]`;
    await say(draft);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('region', { name: 'Preview' });
    const previewed = preview.querySelector('.kb-bb')!.innerHTML;
    expect(previewed).toContain('<strong>bold</strong>');
    await waitFor(() => expect(preview).toHaveTextContent('Post #1'));
    await userEvent.click(send());
    await waitFor(() => expect(post(3)).toBeInTheDocument());
    await waitFor(() => expect(post(3)).toHaveTextContent('Post #1'));
    expect(post(3).querySelector('.kb-act-main .kb-bb')!.innerHTML).toBe(previewed);
  });

  test('toggles, says so to a screen reader, and says there is nothing to preview for an empty draft', async () => {
    const w = threadWorld();
    openThread(w);
    await replyBox();
    const toggle = screen.getByRole('button', { name: 'Preview' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(await screen.findByRole('region', { name: 'Preview' })).getByText('Nothing to preview yet.')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
  });
});

describe('editing', () => {
  test('is offered on the player\'s own characters\' posts only', async () => {
    const w = threadWorld(3);
    openThread(w);
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    const theirs = await screen.findByRole('article', { name: /^Post 3 by Spritey/u });
    expect(within(mine).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(theirs).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  test('edits in place as the post\'s own character, whoever is in the HUD, and shows the draft\'s preview', async () => {
    const w = threadWorld(3);
    const edited = vi.spyOn(w.fake, 'edit');
    openThread(w);
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to Zed' }));
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const form = within(mine).getByRole('form', { name: 'Edit post 2' });
    expect(within(form).getByText('Editing as')).toBeInTheDocument();
    expect(within(form).getByText('Pipewrench').tagName).toBe('STRONG');
    expect(within(form).getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    const box = within(form).getByRole('textbox', { name: 'Your edit' });
    expect(box).toHaveValue('post 2');
    expect(box).toHaveFocus();
    await userEvent.clear(box);
    await userEvent.paste('post 2, [b]fixed[/b]');
    await userEvent.click(within(form).getByRole('button', { name: 'Preview' }));
    expect(within(form).getByRole('region', { name: 'Preview' })).toContainHTML('<strong>fixed</strong>');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mine.querySelector('form')).toBeNull());
    expect(edited).toHaveBeenCalledWith(w.ids[1], w.pipe, 'post 2, [b]fixed[/b]');
    expect(mine.querySelector('.kb-bb strong')).toHaveTextContent('fixed');
  });

  test('Cancel leaves the post as it was; a refusal is shown in the server\'s words and keeps the edit', async () => {
    const w = threadWorld(3);
    vi.spyOn(w.fake, 'edit').mockResolvedValue({ ok: false, error: 'that is not a post of this character\'s' });
    openThread(w);
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const box = within(mine).getByRole('textbox', { name: 'Your edit' });
    await userEvent.type(box, ' more');
    await userEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    expect(await within(mine).findByRole('alert')).toHaveTextContent('that is not a post of this character\'s');
    expect(box).toHaveValue('post 2 more');
    await userEvent.click(within(mine).getByRole('button', { name: 'Cancel' }));
    expect(mine.querySelector('form')).toBeNull();
    expect(mine).toHaveTextContent('post 2');
    expect(mine).not.toHaveTextContent('post 2 more');
    expect(within(mine).getByRole('button', { name: 'Edit' })).toHaveFocus();
  });

  test('an edit inside the grace period shows no "Last edited" and is in the History; one after it shows both', async () => {
    const w = threadWorld(3);
    openThread(w);
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const box = within(mine).getByRole('textbox', { name: 'Your edit' });
    await userEvent.clear(box);
    await userEvent.paste('post 2, typo fixed');
    await userEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mine).toHaveTextContent('post 2, typo fixed'));
    expect(mine).not.toHaveTextContent('Last edited');
    await userEvent.click(within(mine).getByRole('button', { name: 'History' }));
    const list = await within(mine).findByRole('list', { name: 'Versions of this post, oldest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Original');
    expect(items[0]).toHaveTextContent('post 2');
    expect(items[1]).toHaveTextContent('post 2, typo fixed');
    expect(items[1]).toHaveTextContent('Current');
    /* After the grace period an edit is shown, and the History has all three. */
    w.fake.clock.advance(10 * 60_000);
    await userEvent.click(within(mine).getByRole('button', { name: 'History' }));
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const again = within(mine).getByRole('textbox', { name: 'Your edit' });
    await userEvent.clear(again);
    await userEvent.paste('post 2, rewritten');
    await userEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mine).toHaveTextContent('Last edited'));
    await userEvent.click(within(mine).getByRole('button', { name: 'History' }));
    expect(within(await within(mine).findByRole('list', { name: 'Versions of this post, oldest first' })).getAllByRole('listitem')).toHaveLength(3);
  });

  test('the History is for everyone: another player\'s edited post lists its versions, and an unedited post says it has none', async () => {
    const w = threadWorld(3);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.ids[1]!, w.pipe, 'post 2, edited');
    w.fake.signInAs(w.other);
    openThread(w);
    const edited = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    expect(within(edited).queryByRole('button', { name: 'Edit' })).toBeNull();
    await userEvent.click(within(edited).getByRole('button', { name: 'History' }));
    expect(within(await within(edited).findByRole('list', { name: 'Versions of this post, oldest first' })).getAllByRole('listitem')).toHaveLength(2);
    const plain = await screen.findByRole('article', { name: /^Post 3 by Spritey/u });
    await userEvent.click(within(plain).getByRole('button', { name: 'History' }));
    expect(await within(plain).findByText('This post has not been edited.')).toBeInTheDocument();
  });

  test('a toolbar press in an edit wraps the selection of the edit box, and offers no latest-post quote', async () => {
    const w = threadWorld(3);
    openThread(w);
    const mine = await screen.findByRole('article', { name: /^Post 2 by Pipewrench/u });
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const box = within(mine).getByRole('textbox', { name: 'Your edit' }) as HTMLTextAreaElement;
    box.setSelectionRange(0, 4);
    fireEvent.select(box);
    await userEvent.click(within(mine).getByRole('button', { name: 'Italic' }));
    expect(box).toHaveValue('[i]post[/i] 2');
    expect(within(mine).queryByRole('button', { name: 'Quote the latest post' })).toBeNull();
  });
});
