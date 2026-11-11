/**
 * The box a barred mask's composer holds (docs/plans/2026-11-06-member-groups-plan.md, Task 10; the mockup's last panel, docs/research/2026-11-06-member-groups/01-bars.html): a
 * conferGroup move bars Pipewrench from General, and where it would reply the page says so, plainly and truthfully, with the way out. The bar is per character, so the same
 * player's other mask posts freely; the three states of an apology (none, waiting, rejected) each say what is true; a banned mask is told of its ban instead.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { dayAndTime } from '../characters/format.ts';
import { shortDate } from '../postbit/dates.ts';
import { testInstance } from '../test-world.tsx';
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
  w.fake.seed.wallet(w.me, 500);
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

  test('keeps naming the office the move landed under when the persona\'s office changes', async () => {
    const w = barred('mod');
    w.fake.seed.setOffice('director', 'boss');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    const box = await screen.findByRole('heading', { name: /can't post on General/u });
    expect(box.closest('section')).toHaveTextContent(/A Mod put Pipewrench/u);
    expect(box.closest('section')).not.toHaveTextContent('Boss');
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

  test('offers Appeal after See the move, naming who hears it and the price', async () => {
    const w = barred();
    openThread(w, undefined, { settings: { groups: GROUPS } });
    const appeal = await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' });
    const see = await screen.findByRole('link', { name: 'See the move' });
    expect(see.compareDocumentPosition(appeal) & Node.DOCUMENT_POSITION_FOLLOWING, 'Appeal stands after See the move').toBeTruthy();
    expect(appeal).toHaveAttribute('aria-haspopup', 'dialog');
  });

  test('names a Mod where a Mod made the move', async () => {
    const w = barred('mod');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    expect(await screen.findByRole('button', { name: 'Appeal to a Mod · 0.50 Aura' })).toBeInTheDocument();
  });

  test('opens the appeal form on the move: plain terms of the four rulings, and sends the move\'s Act through fileAppeal', async () => {
    const w = barred();
    const file = vi.spyOn(w.fake, 'fileAppeal');
    w.fake.seed.judging({ appeal: 'reduced' });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await userEvent.click(await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' }));
    const dialog = await screen.findByRole('dialog', { name: 'Appeal the move' });
    const form = await within(dialog).findByRole('form', { name: 'Appeal' });
    expect(form).toHaveTextContent(/The punishment: Pipewrench is in Trial Members, which can't post on General\. It began .+ and ends by itself .+\./u);
    expect(form).toHaveTextContent('The one who made the move (the Boss) hears it, or the Boss if they have left the staff. If it is overturned the move ends at once and your Aura is refunded. If it is upheld nothing changes. If it is reduced the move is cut to half its length, counted from when it began, and ends at once if that time has passed. If it is increased the move runs half its length longer, though never past the longest a move may run. One judged appeal per move, your plea is public, and an apology can still end the move: whichever comes first does.');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Your plea (public)' }), 'I have learned.');
    await userEvent.click(within(form).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('The Boss heard it and cut the move to half its length.'));
    expect(file).toHaveBeenCalledWith(w.pipe, w.move, 'I have learned.');
    expect((await w.fake.log()).appeals[0]).toMatchObject({ punishment: w.move, punishmentKind: 'move', verdict: 'reduced', character: w.pipe });
    expect(await w.fake.wallet()).toMatchObject({ balance: 450 });
  });

  test('a made appeal moves focus to the note that says so', async () => {
    const w = barred();
    w.fake.seed.judging({ appeal: 'upheld' });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await userEvent.click(await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' }));
    const dialog = await screen.findByRole('dialog', { name: 'Appeal the move' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Your plea (public)' }), 'Please.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Appeal · 0.50 Aura' }));
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('heard it'));
    await userEvent.keyboard('{Escape}');
    const note = await screen.findByText('This move has been appealed. Each move gets one judged appeal.');
    await waitFor(() => expect(note).toHaveFocus());
  });

  test('an increased ruling adds half the length but never goes past the most days from landing, as the server clamps it', async () => {
    const w = threadWorld(2, { groups: GROUPS });
    const most = testInstance.settings.moveExpiryMostDays;
    w.fake.seed.wallet(w.me, 500);
    w.fake.seed.staff('director', 'The Director', 'boss');
    const at = Date.now() - 3_600_000;
    w.fake.seed.groupMove('director', { character: w.pipe, group: 'trialMembers', board: 'general', at, expiresAt: at + (most - 1) * DAY });
    w.fake.seed.judging({ appeal: 'increased' });
    const move = (await w.fake.myCharacters())[0]!.bars![0]!.move;
    expect((await w.fake.fileAppeal(w.pipe, move, 'More.')).ok).toBe(true);
    expect(Date.parse((await w.fake.myCharacters())[0]!.bars![0]!.expiresAt!)).toBe(at + most * DAY);
  });

  test('says plainly that a move with no end date cannot be shortened or lengthened', async () => {
    const w = threadWorld(2, { groups: GROUPS });
    w.fake.seed.staff('director', 'The Director', 'boss');
    w.fake.seed.groupMove('director', { character: w.pipe, group: 'trialMembers', board: 'general', at: Date.now() - 3_600_000, expiresAt: null });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await userEvent.click(await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' }));
    expect(await screen.findByRole('form', { name: 'Appeal' })).toHaveTextContent('It has no end date, so a reduction or an increase changes nothing and is recorded as upheld.');
  });

  test('is gone once an appeal of this move is used, and comes back when it was refunded', async () => {
    const w = barred();
    w.fake.seed.judging({ appeal: 'failed' });
    await w.fake.fileAppeal(w.pipe, w.move, 'First.');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    expect(await screen.findByRole('button', { name: 'Appeal to the Boss · 0.50 Aura' }), 'a failed judgment refunds, so it may be made again').toBeInTheDocument();
    cleanup();
    w.fake.seed.judging({ appeal: 'upheld' });
    await w.fake.fileAppeal(w.pipe, w.move, 'Second.');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await screen.findByRole('link', { name: 'See the move' });
    expect(screen.queryByRole('button', { name: /^Appeal to/u })).toBeNull();
    const note = screen.getByText('This move has been appealed. Each move gets one judged appeal.');
    expect(note).toBeInTheDocument();
    expect(note, 'focused where the button was, and not also a live region: one announcement').not.toHaveAttribute('role');
  });

  test('is not offered for a bar a favor carries, which is no punishment', async () => {
    const w = threadWorld(2, { groups: GROUPS });
    w.fake.seed.staff('director', 'The Director', 'boss');
    w.fake.seed.groupMove('director', { character: w.pipe, group: 'teachersPet', board: 'general', at: Date.now() - 3_600_000 });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await screen.findByRole('link', { name: 'See the move' });
    expect(screen.queryByRole('button', { name: /^Appeal to/u })).toBeNull();
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
    await userEvent.type(within(form).getByLabelText('Your apology'), 'I was wrong.');
    await userEvent.click(within(form).getByRole('button', { name: 'Send apology' }));
    await waitFor(() => expect(apologize).toHaveBeenCalledWith(w.move, w.pipe, 'I am sorry', 'I was wrong.'));
    expect(spin).not.toHaveBeenCalled();
  });

  test('the apology form labels its body as the apology, and sends only once it holds something other than whitespace', async () => {
    const w = barred();
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await userEvent.click(await screen.findByRole('button', { name: 'Write an apology' }));
    const form = await screen.findByRole('form', { name: /apology/iu });
    expect(within(form).getByLabelText('Your apology')).toBeInTheDocument();
    expect(within(form).queryByText(/optional/iu)).toBeNull();
    await userEvent.type(within(form).getByLabelText('Thread title'), 'I am sorry');
    expect(within(form).getByRole('button', { name: 'Send apology' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Your apology'), '   ');
    expect(within(form).getByRole('button', { name: 'Send apology' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Your apology'), 'I was wrong.');
    expect(within(form).getByRole('button', { name: 'Send apology' })).toBeEnabled();
  });

  test('an apology the rule calls empty is refused on the form in the field\'s words, which stays open with what was typed, and a body then typed sends it', async () => {
    const w = barred();
    const apologize = vi.spyOn(w.fake, 'apologize');
    openThread(w, undefined, { settings: { groups: GROUPS } });
    await userEvent.click(await screen.findByRole('button', { name: 'Write an apology' }));
    const form = await screen.findByRole('form', { name: /apology/iu });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'I am sorry');
    /* A zero-width space is something other than whitespace to the button and empty to the rule. */
    await userEvent.type(within(form).getByLabelText('Your apology'), '\u200b');
    await userEvent.click(within(form).getByRole('button', { name: 'Send apology' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Your apology is empty');
    expect(screen.getByRole('form', { name: /apology/iu })).toBeInTheDocument();
    expect(within(form).getByLabelText('Thread title')).toHaveValue('I am sorry');
    await userEvent.type(within(form).getByLabelText('Your apology'), 'I was wrong.');
    await userEvent.click(within(form).getByRole('button', { name: 'Send apology' }));
    await waitFor(() => expect(apologize).toHaveBeenLastCalledWith(w.move, w.pipe, 'I am sorry', '\u200bI was wrong.'));
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

describe('a returned apology', () => {
  test('says it could not be judged, and offers another at once', async () => {
    const w = barred();
    w.fake.seed.apology(w.pipe, w.move, 'returned', { at: Date.now() - 60_000 });
    openThread(w, undefined, { settings: { groups: GROUPS } });
    expect(await screen.findByText('Your last apology couldn\'t be judged. You can write another.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write an apology' })).toBeInTheDocument();
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
    /* The one Appeal on the page is the ban's, to the Boss; the move's is not offered while the ban holds. */
    expect(screen.getAllByRole('button', { name: /^Appeal to/u })).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Appeal the move' })).toBeNull();
  });
});
