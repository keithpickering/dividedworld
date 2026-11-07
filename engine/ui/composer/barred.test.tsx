/**
 * The box a barred mask's composer holds (docs/plans/2026-11-06-member-groups-plan.md, Task 10; the mockup's last panel, docs/research/2026-11-06-member-groups/01-bars.html): a
 * conferGroup move bars Pipewrench from General, and where it would reply the page says so, plainly and truthfully, with the way out. The bar is per character, so the same
 * player's other mask posts freely; the three states of an apology (none, waiting, rejected) each say what is true; a banned mask is told of its ban instead.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { dayAndTime } from '../characters/format.ts';
import { shortDate } from '../postbit/dates.ts';
import { openThread, replyBox, threadWorld } from './support.tsx';

const DAY = 86_400_000;
const GROUPS = [
  { key: 'members', name: 'Members', color: '#7a7a7a', stripe: false, staff: false },
  { key: 'trialMembers', name: 'Trial Members', badge: 'Trial Member', color: '#d2691e', stripe: true, staff: false },
  { key: 'staff', name: 'Test Cores', color: '#d4a017', stripe: false, staff: true },
];

beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** Pipewrench is barred from General by the Boss (or a Mod, `by: 'mod'`) for three days, and may apologize. */
function barred(by: 'boss' | 'mod' = 'boss') {
  const w = threadWorld(2, { groups: GROUPS });
  const boss = w.fake.seed.staff('director', 'The Director', by);
  const at = Date.now() - 3_600_000;
  const move = w.fake.seed.groupMove('director', { character: w.pipe, group: 'trialMembers', board: 'general', at, expiresAt: at + 3 * DAY });
  return { ...w, boss, move, at, ends: at + 3 * DAY };
}

describe('the box of a barred mask', () => {
  test('stands where the reply box would, in plain board words, naming the board, the group, the date and the end', async () => {
    const w = barred();
    openThread(w, undefined, { settings: { groups: GROUPS } });
    const box = await screen.findByRole('heading', { name: 'Pipewrench can\'t post on General right now.' });
    const region = box.closest('section, div, form')!;
    expect(region).toHaveTextContent(`The Boss put Pipewrench in Trial Members on ${shortDate(new Date(w.at).toISOString())}, and Trial Members can't post here.`);
    expect(region).toHaveTextContent(`It ends on ${shortDate(new Date(w.ends).toISOString())}, or sooner if the Boss accepts a public apology. You can still read everything here.`);
    expect(screen.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  test('names a Mod\'s move by the Mod, not the Boss', async () => {
    const w = barred('mod');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    const box = await screen.findByRole('heading', { name: 'Pipewrench can\'t post on General right now.' });
    const region = box.closest('section, div, form')!;
    expect(region).toHaveTextContent(/A Mod put Pipewrench in Trial Members on/u);
    expect(region).toHaveTextContent(/or sooner if a Mod accepts a public apology/u);
    expect(region).not.toHaveTextContent('Boss');
  });

  test('goes with the mask: the same player\'s other character posts freely, and swapping back brings it again', async () => {
    const w = barred();
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await screen.findByRole('heading', { name: /can't post on General/u });
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /can't post on General/u })).toBeNull());
    await userEvent.click(await replyBox());
    await userEvent.paste('Zed speaks.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Pipewrench' }));
    expect(await screen.findByRole('heading', { name: /can't post on General/u })).toBeInTheDocument();
  });

  test('is not there for a mask on another board\'s bar, nor once the move has ended', async () => {
    const w = barred();
    w.fake.seed.endMove(w.move, { why: 'met' });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await replyBox();
    expect(screen.queryByRole('heading', { name: /can't post on/u })).toBeNull();
  });

  test('links to the move\'s post', async () => {
    const w = barred();
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await screen.findByRole('heading', { name: /can't post on General/u });
    const move = await w.fake.act(w.move);
    const link = await screen.findByRole('link', { name: 'See the move' });
    expect(link).toHaveAttribute('href', `/t/${move!.thread}?page=1#post-${move!.seq}`);
  });

  test('holds no Appeal yet: that is the appeal task\'s button', async () => {
    const w = barred();
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await screen.findByRole('heading', { name: /can't post on General/u });
    expect(screen.queryByRole('button', { name: /^Appeal/u })).toBeNull();
  });

  test('has no accessibility violations', async () => {
    const w = barred();
    const { container } = openThread(w, undefined, { settings: { groups: GROUPS } });
    await screen.findByRole('heading', { name: /can't post on General/u });
    const found = await axeViolations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('the three states of an apology', () => {
  test('none yet: Write an apology opens the composer as a spin of the move, and sending it is through apologize', async () => {
    const w = barred();
    const apologize = vi.spyOn(w.fake, 'apologize');
    const spin = vi.spyOn(w.fake, 'spin');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await userEvent.click(await screen.findByRole('button', { name: 'Write an apology' }));
    const form = await screen.findByRole('form', { name: /apology/iu });
    expect(form).toHaveTextContent('Pipewrench');
    await userEvent.type(within(form).getByLabelText('Thread title'), 'I am sorry');
    await userEvent.type(within(form).getByLabelText(/Your opening post/u), 'I was wrong.');
    await userEvent.click(within(form).getByRole('button', { name: 'Send apology' }));
    await waitFor(() => expect(apologize).toHaveBeenCalledWith(w.move, w.pipe, 'I am sorry', 'I was wrong.'));
    expect(spin).not.toHaveBeenCalled();
  });

  test('waiting: says it is with the Boss, and offers no second one', async () => {
    const w = barred();
    w.fake.seed.apology(w.pipe, w.move, 'pending');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    expect(await screen.findByText('Your apology is with the Boss.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write an apology' })).toBeNull();
  });

  test('waiting on a Mod: says it is with a Mod', async () => {
    const w = barred('mod');
    w.fake.seed.apology(w.pipe, w.move, 'pending');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    expect(await screen.findByText('Your apology is with a Mod.')).toBeInTheDocument();
  });

  test('rejected: says when the next may be written, and offers none before then', async () => {
    const w = barred();
    const wrote = Date.now() - 3_600_000;
    w.fake.seed.apology(w.pipe, w.move, 'rejected', { at: wrote });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    const next = new Date(wrote + 24 * 3_600_000).toISOString();
    expect(await screen.findByText(`Your last apology was turned down. The next can be written ${dayAndTime(next)}.`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write an apology' })).toBeNull();
  });

  test('a rejection a day old no longer waits: the apology can be written again', async () => {
    const w = barred();
    w.fake.seed.apology(w.pipe, w.move, 'rejected', { at: Date.now() - 25 * 3_600_000 });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    expect(await screen.findByRole('button', { name: 'Write an apology' })).toBeInTheDocument();
  });

  test('returned: the judgment failed, and the next may be written at once', async () => {
    const w = barred();
    w.fake.seed.apology(w.pipe, w.move, 'returned', { at: Date.now() - 60_000 });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    expect(await screen.findByRole('button', { name: 'Write an apology' })).toBeInTheDocument();
  });
});

describe('a mask both barred and banned', () => {
  test('is told of its ban instead, and is offered no apology while it holds', async () => {
    const w = barred();
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
    const visit = w.fake.seed.visit(clerk, w.ids[1]!, { at: Date.now() - 3_600_000, endsInMs: 60_000 });
    const inf = w.fake.seed.infraction(visit, { points: 10, band: 'severe' });
    w.fake.seed.ban(w.pipe, Date.now() + 5 * 3_600_000, { infraction: inf });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await screen.findByText(/is banned until/u);
    expect(screen.queryByRole('heading', { name: /can't post on General/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write an apology' })).toBeNull();
  });
});
