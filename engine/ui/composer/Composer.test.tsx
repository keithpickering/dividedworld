import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { Editor } from './Editor.tsx';
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
  test('has no Reveal… button: a class is revealed from the HUD or My characters, never from the reply box', async () => {
    openThread(threadWorld());
    const form = (await replyBox()).closest('form')!;
    expect(within(form).queryByRole('button', { name: /^Reveal/u })).toBeNull();
  });

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
    const said = w.fake.seed.thread('announcements', null, 'The tally', 'Settled.');
    openThread({ ...w, thread: said.thread });
    await screen.findByRole('article', { name: /^Post 1 by the staff/u });
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

  test('sends the characters its counterfeit quotes name as framing, and sends none when it has none', async () => {
    const w = threadWorld();
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    await say(`[quote=Spritey user=${w.spritey}]I never said this.[/quote] [quote=Spritey user=${w.spritey}]Nor this.[/quote]`);
    await userEvent.click(send());
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(posted.mock.calls[0]).toEqual([w.thread, w.pipe, expect.stringContaining('I never said'), null, [w.spritey]]);
    await waitFor(async () => expect(((await w.fake.alerts()).filter((a) => a.kind === 'framed'))).toEqual([]));
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

  test('when the player\'s characters could not be read, it says so and offers Try again instead of making one', async () => {
    const w = threadWorld();
    vi.spyOn(w.fake, 'myCharacters').mockRejectedValue(new Error('down'));
    openThread(w);
    await screen.findByRole('article', { name: /^Post 1 /u });
    expect(await screen.findByText('Your characters couldn\'t be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Make a character' })).toBeNull();
    vi.mocked(w.fake.myCharacters).mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('textbox', { name: 'Your reply' })).toBeInTheDocument();
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
  const tools = ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Link', 'Image', 'Video', 'Spoiler', 'Quote someone…', 'Quote the last post shown', 'Code', 'List'];

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
    await userEvent.click(await screen.findByRole('button', { name: 'Quote the last post shown' }));
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
    const said = w.fake.seed.thread('announcements', null, 'The tally', 'Settled.');
    openThread({ ...w, thread: said.thread });
    const article = await screen.findByRole('article', { name: /^Post 1 by the staff/u });
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
    // A quote's head loads its author and its post number on their own; both renders are compared once each head is whole.
    // Settled is the author's name loaded (a character not yet loaded is linked as "A character"), and the post number located.
    const settled = (el: Element) => {
      expect(el).toHaveTextContent('Post #1');
      const author = el.querySelector('cite a[href^="/c/"]');
      expect(author).not.toBeNull();
      expect(author).not.toHaveTextContent('A character');
    };
    await waitFor(() => settled(preview));
    const previewed = preview.querySelector('.kb-bb')!.innerHTML;
    expect(previewed).toContain('<strong>bold</strong>');
    await userEvent.click(send());
    await waitFor(() => expect(post(3)).toBeInTheDocument());
    await waitFor(() => settled(post(3)));
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
    expect(within(mine).queryByRole('button', { name: 'Quote the last post shown' })).toBeNull();
  });
});

describe('the new tools, the shortcuts and the paste offer', () => {
  const pick = async (text: string, from: number, to: number) => {
    const box = (await say(text)) as HTMLTextAreaElement;
    box.setSelectionRange(from, to);
    return box;
  };

  test('Spoiler and Video press into the box', async () => {
    const w = threadWorld();
    openThread(w);
    const box = await pick('the butler did it', 4, 10);
    await userEvent.click(screen.getByRole('button', { name: 'Spoiler' }));
    expect(box).toHaveValue('the [ispoiler]butler[/ispoiler] did it');
    box.setSelectionRange(0, 0);
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(box).toHaveValue('[video][/video]the [ispoiler]butler[/ispoiler] did it');
    expect(box.selectionStart).toBe('[video]'.length);
  });

  describe('Quote someone…', () => {
    test('opens a dialog; choosing a character wraps the selection as that character and returns focus to the box', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await pick('I never said this', 0, 17);
      await userEvent.click(screen.getByRole('button', { name: 'Quote someone…' }));
      const dialog = await screen.findByRole('dialog', { name: /Quote someone/u });
      await userEvent.type(within(dialog).getByRole('combobox'), 'Spri');
      await userEvent.click(await within(dialog).findByRole('option', { name: /Spritey/u }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(box).toHaveValue(`[quote=Spritey user=${w.spritey}]I never said this[/quote]`);
      expect(box).toHaveFocus();
    });

    test('Escape closes it with nothing inserted and focus back in the box', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await pick('keep me', 0, 7);
      await userEvent.click(screen.getByRole('button', { name: 'Quote someone…' }));
      await screen.findByRole('dialog', { name: /Quote someone/u });
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(box).toHaveValue('keep me');
      expect(box).toHaveFocus();
    });

    test('passes axe with the dialog open', async () => {
      const w = threadWorld();
      openThread(w);
      await pick('x', 0, 1);
      await userEvent.click(screen.getByRole('button', { name: 'Quote someone…' }));
      const dialog = await screen.findByRole('dialog', { name: /Quote someone/u });
      const bad = await axeViolations(dialog);
      expect(bad, describeViolations(bad)).toEqual([]);
    });
  });

  describe('shortcuts', () => {
    test.each([['b', '[b]word[/b]'], ['i', '[i]word[/i]'], ['u', '[u]word[/u]'], ['k', '[url=]word[/url]']])('Ctrl+%s applies the tool and the browser\'s own is prevented', async (key, want) => {
      const w = threadWorld();
      openThread(w);
      const box = await pick('word', 0, 4);
      const stopped = fireEvent.keyDown(box, { key, ctrlKey: true });
      expect(stopped).toBe(false);
      expect(box).toHaveValue(want);
    });
    test('Command works as Control does, and a bare letter types', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await pick('word', 0, 4);
      expect(fireEvent.keyDown(box, { key: 'b' })).toBe(true);
      expect(box).toHaveValue('word');
      expect(fireEvent.keyDown(box, { key: 'B', metaKey: true })).toBe(false);
      expect(box).toHaveValue('[b]word[/b]');
    });
  });

  describe('paste to embed', () => {
    const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const offer = () => screen.queryByText(/Embed this video\?|Show this image\?/u);

    test('a pasted video link stays as written and offers; Embed wraps it in place as one insertion', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await say(`watch ${YT} now`);
      expect(offer()).toBeNull();
      await userEvent.clear(box);
      await userEvent.paste('before ');
      await userEvent.paste(YT);
      expect(box).toHaveValue(`before ${YT}`);
      const line = (await screen.findByText('Embed this video?')).closest('[role="status"]') as HTMLElement;
      const bad = await axeViolations(line.closest('.kb-editor')!);
      expect(bad, describeViolations(bad)).toEqual([]);
      await userEvent.click(within(line).getByRole('button', { name: 'Embed' }));
      expect(box).toHaveValue(`before [video]${YT}[/video]`);
      expect(offer()).toBeNull();
    });

    test('typing dismisses it, and nothing is converted', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await replyBox();
      await userEvent.click(box);
      await userEvent.paste(YT);
      await screen.findByText('Embed this video?');
      await userEvent.keyboard('!');
      expect(offer()).toBeNull();
      expect(box).toHaveValue(`${YT}!`);
    });

    test('Keep as link dismisses it and leaves the text', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await replyBox();
      await userEvent.click(box);
      await userEvent.paste(YT);
      await userEvent.click(await screen.findByRole('button', { name: 'Keep as link' }));
      expect(offer()).toBeNull();
      expect(box).toHaveValue(YT);
    });

    test('an https image address offers to show it', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await replyBox();
      await userEvent.click(box);
      await userEvent.paste('  https://example.test/a/pic.JPG  ');
      await screen.findByText('Show this image?');
      await userEvent.click(screen.getByRole('button', { name: 'Embed' }));
      expect(box).toHaveValue('  [img]https://example.test/a/pic.JPG[/img]  ');
    });

    test('a pasted sentence, a plain page link and an http image offer nothing', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await replyBox();
      await userEvent.click(box);
      for (const text of ['look at this https://example.test/pic.png please', 'https://example.test/page', 'http://example.test/pic.png']) {
        await userEvent.clear(box);
        await userEvent.paste(text);
        expect(offer()).toBeNull();
      }
    });

    test('if the link has moved or changed, Embed is not offered any longer', async () => {
      const w = threadWorld();
      openThread(w);
      const box = await replyBox();
      await userEvent.click(box);
      await userEvent.paste(YT);
      await screen.findByText('Embed this video?');
      await userEvent.type(box, 'x', { initialSelectionStart: 0, initialSelectionEnd: 0 });
      expect(offer()).toBeNull();
    });
  });
});

describe('the Editor on its own', () => {
  const mount = () => render(<><button type="button">before</button><Editor label="Box" value="hello" onChange={() => {}} max={100} /></>);

  test('mounting leaves focus where it was and the caret untouched', async () => {
    const view = render(<button type="button">before</button>);
    const before = screen.getByRole('button', { name: 'before' });
    before.focus();
    view.rerender(<><button type="button">before</button><Editor label="Box" value="hello" onChange={() => {}} max={100} /></>);
    await act(async () => { await Promise.resolve(); });
    expect(before).toHaveFocus();
    const box = screen.getByRole('textbox', { name: 'Box' }) as HTMLTextAreaElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(0);
  });

  test('a paste that fires no change does not swallow the next edit', async () => {
    const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    let v = '';
    const view = render(<Editor label="Box" value={v} onChange={(n) => { v = n; }} max={100} />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    fireEvent.paste(box, { clipboardData: { getData: () => YT } });
    await screen.findByText('Embed this video?');
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    fireEvent.change(box, { target: { value: 'x' } });
    expect(screen.queryByText('Embed this video?')).toBeNull();
    view.unmount();
  });

  describe('shortcuts and platform', () => {
    const platform = (p: string) => vi.spyOn(navigator, 'platform', 'get').mockReturnValue(p);
    const word = () => {
      mount();
      const box = screen.getByRole('textbox', { name: 'Box' }) as HTMLTextAreaElement;
      box.setSelectionRange(0, 5);
      return box;
    };
    test('while an input method is composing, nothing happens', () => {
      const box = word();
      expect(fireEvent.keyDown(box, { key: 'b', ctrlKey: true, isComposing: true })).toBe(true);
      expect(fireEvent.keyDown(box, { key: 'b', ctrlKey: true, keyCode: 229 })).toBe(true);
    });
    test('on a Mac Control+B is left to the system and Command+B bolds', () => {
      platform('MacIntel');
      const box = word();
      expect(fireEvent.keyDown(box, { key: 'b', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(box, { key: 'b', metaKey: true })).toBe(false);
    });
    test('elsewhere Control+B bolds', () => {
      platform('Win32');
      const box = word();
      expect(fireEvent.keyDown(box, { key: 'b', ctrlKey: true })).toBe(false);
    });
  });
});
