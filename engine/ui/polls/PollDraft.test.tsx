import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { draftKey, readDraft, writeDraft } from '../composer/draft.ts';
import { openThread, replyBox, threadWorld } from '../composer/support.tsx';
import { lastsChoices, problemOf, emptyPoll } from './PollDraft.tsx';

beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const settings = { pollOptionsMax: 3, pollQuestionMax: 20, pollOptionMax: 10, pollLastsMin: { unit: 'hour', count: 1 }, pollLastsMax: { unit: 'week', count: 1 } } as const;

describe('the choices and the problems', () => {
  test('Closes in offers the five lengths the settings allow', () => {
    expect(lastsChoices(settings).map((c) => `${c.count} ${c.unit}`)).toEqual(['1 hour', '1 day', '3 day', '1 week']);
  });
  test('a fresh poll has two empty options and says the question first', () => {
    expect(emptyPoll(settings).options).toEqual(['', '']);
    expect(problemOf(emptyPoll(settings), settings)).toBe('question is empty');
  });
});

describe('a draft keeps its poll', () => {
  test('round-trips through draft.ts, and a poll alone keeps a draft with no words', () => {
    const poll = { question: 'Best?', options: ['a', 'b'], pick: 1, secret: true, lasts: { unit: 'day', count: 3 } } as const;
    writeDraft('k', { text: '', as: null, poll });
    expect(readDraft('k')).toEqual({ text: '', as: null, poll });
    writeDraft('k', { text: '', as: null });
    expect(readDraft('k')).toBeNull();
  });
});

describe('the reply box', () => {
  test('Add a poll opens the fieldset, Remove poll closes it, and each problem shows under its field', async () => {
    openThread(threadWorld());
    await replyBox();
    await userEvent.click(screen.getByRole('button', { name: 'Add a poll' }));
    const set = screen.getByRole('group', { name: 'Poll' });
    expect(within(set).getAllByRole('textbox', { name: /^Option / })).toHaveLength(2);
    expect(within(set).queryByRole('button', { name: /^Remove option/u })).toBeNull();
    await userEvent.click(within(set).getByRole('button', { name: 'Add option' }));
    expect(within(set).getAllByRole('button', { name: /^Remove option/u })).toHaveLength(3);
    await userEvent.click(within(set).getByRole('button', { name: 'Remove option 3' }));
    await userEvent.click(await replyBox());
    await userEvent.paste('With a poll.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await within(set).findByRole('alert')).toHaveTextContent('question is empty');
    await userEvent.type(within(set).getByRole('textbox', { name: 'Question' }), 'Best?');
    await userEvent.type(within(set).getByRole('textbox', { name: 'Option 1' }), 'Same');
    await userEvent.type(within(set).getByRole('textbox', { name: 'Option 2' }), 'Same');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await within(set).findByRole('alert')).toHaveTextContent('no two options are the same');
    await userEvent.click(within(set).getByRole('button', { name: 'Remove poll' }));
    expect(screen.queryByRole('group', { name: 'Poll' })).toBeNull();
  });

  test('sends the poll with the reply and keeps it in the draft until then', async () => {
    const w = threadWorld();
    const posted = vi.spyOn(w.fake, 'post');
    openThread(w);
    await replyBox();
    await userEvent.click(screen.getByRole('button', { name: 'Add a poll' }));
    const set = screen.getByRole('group', { name: 'Poll' });
    await userEvent.type(within(set).getByRole('textbox', { name: 'Question' }), 'Best?');
    await userEvent.type(within(set).getByRole('textbox', { name: 'Option 1' }), 'Yes');
    await userEvent.type(within(set).getByRole('textbox', { name: 'Option 2' }), 'No');
    await userEvent.click(await replyBox());
    await userEvent.paste('Vote.');
    expect(readDraft(draftKey(w.me, w.thread))?.poll?.question).toBe('Best?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(posted.mock.calls[0]![5]).toEqual({ question: 'Best?', options: ['Yes', 'No'], pick: 1, secret: false, lasts: { unit: 'day', count: 1 } });
    await waitFor(() => expect(readDraft(draftKey(w.me, w.thread))).toBeNull());
  });
});

describe('Edit', () => {
  test('a post with no poll offers Add a poll, and the edit sends it', async () => {
    const w = threadWorld();
    const edited = vi.spyOn(w.fake, 'edit');
    openThread(w);
    const mine = (await screen.findByText('post 2')).closest('article')!;
    await userEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    const form = within(mine).getByRole('form', { name: /^Edit post/u });
    await userEvent.click(within(form).getByRole('button', { name: 'Add a poll' }));
    await userEvent.type(within(form).getByRole('textbox', { name: 'Question' }), 'Best?');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Option 1' }), 'Yes');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Option 2' }), 'No');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(edited).toHaveBeenCalledTimes(1));
    expect(edited.mock.calls[0]![3]).toMatchObject({ question: 'Best?', options: ['Yes', 'No'] });
  });
});
