/**
 * New thread agrees with the reply box (docs/plans/2026-11-06-member-groups-plan.md, Task 10, amended 2026-11-07): a mask barred from the board, or banned, is told so
 * where the form's fields would be, with the same words and the same way out; the same player's other mask starts a thread freely.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { LoadedBoard } from '../loaded.tsx';
import { Swapper } from '../composer/support.tsx';
import { renderInWorld } from '../test-world.tsx';

beforeEach(() => localStorage.clear());

const GROUPS = [
  { key: 'members', name: 'Members', color: '#7a7a7a', stripe: false, staff: false },
  { key: 'trialMembers', name: 'Trial Members', badge: 'Trial Member', color: '#d2691e', stripe: true, staff: false },
  { key: 'staff', name: 'Test Cores', color: '#d4a017', stripe: false, staff: true },
];

function seed(fake: Fake, o: { readonly banned?: boolean } = {}) {
  const me = fake.seed.account('me');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  fake.seed.character(me, 'Zed', 'face');
  fake.seed.staff('director', 'The Director', 'boss');
  const move = fake.seed.groupMove('director', { character: pipe, group: 'trialMembers', board: 'general', at: Date.now() - 3_600_000, expiresAt: Date.now() + 3 * 86_400_000 });
  if (o.banned) {
    const clerk = fake.seed.staff('clerk', 'The Clerk', 'mod');
    const spritey = fake.seed.character(fake.seed.account('other'), 'Spritey', 'face');
    const { act } = fake.seed.thread('general', spritey, 'A thread', 'first');
    const visit = fake.seed.visit(clerk, act, { at: Date.now() - 3_600_000, endsInMs: 60_000 });
    fake.seed.ban(pipe, Date.now() + 5 * 3_600_000, { infraction: fake.seed.infraction(visit, { points: 10, band: 'severe' }) });
  }
  fake.signInAs(me);
  return { pipe, move };
}

/** The box New thread opens: a form while it takes a thread, a plain section while a ban or a bar stands in its place (the apology is a form of its own and may not nest in one). */
async function openForm(held = true) {
  await userEvent.click(await screen.findByRole('button', { name: 'Start a thread' }));
  return held ? screen.findByRole('region', { name: 'Start a thread' }) : screen.findByRole('form', { name: 'Start a thread' });
}

const page = () => <><LoadedBoard slug="general" /><Swapper /></>;

describe('New thread for a barred mask', () => {
  test('holds the barred box where the fields would be, and nothing to type into', async () => {
    renderInWorld(page(), { settings: { groups: GROUPS }, seed: (f) => seed(f) });
    const form = await openForm();
    expect(await within(form).findByRole('heading', { name: 'Pipewrench can\'t post on General right now.' })).toBeInTheDocument();
    expect(form).toHaveTextContent(/The Boss put Pipewrench in Trial Members on .+, and Trial Members can't post here\. It ends on .+, or sooner if the Boss accepts a public apology\./u);
    expect(within(form).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Start thread' })).toBeNull();
    expect(within(form).getByRole('button', { name: 'Write an apology' })).toBeInTheDocument();
    expect(within(form).getByRole('link', { name: 'See the move' })).toBeInTheDocument();
  });

  test('is gone for the same player\'s other mask, which starts a thread', async () => {
    renderInWorld(page(), { settings: { groups: GROUPS }, seed: (f) => seed(f) });
    const form = await openForm();
    await within(form).findByRole('heading', { name: /can't post on General/u });
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    const open = await screen.findByRole('form', { name: 'Start a thread' });
    expect(screen.queryByRole('heading', { name: /can't post on General/u })).toBeNull();
    expect(within(open).getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  });

  test('Write an apology is through apologize and not startThread', async () => {
    const { fake } = renderInWorld(page(), { settings: { groups: GROUPS }, seed: (f) => seed(f) });
    const apologize = vi.spyOn(fake, 'apologize');
    const start = vi.spyOn(fake, 'startThread');
    const form = await openForm();
    await userEvent.click(await within(form).findByRole('button', { name: 'Write an apology' }));
    const sorry = await screen.findByRole('form', { name: /apology/iu });
    await userEvent.type(within(sorry).getByLabelText('Thread title'), 'Sorry');
    await userEvent.type(within(sorry).getByLabelText('Your apology'), 'I am sorry.');
    await userEvent.click(within(sorry).getByRole('button', { name: 'Send apology' }));
    await waitFor(() => expect(apologize).toHaveBeenCalled());
    expect(start).not.toHaveBeenCalled();
  });
});

describe('New thread for a banned mask', () => {
  test('shows the ban note, as the reply box does, instead of the fields, and no apology', async () => {
    renderInWorld(page(), { settings: { groups: GROUPS }, seed: (f) => seed(f, { banned: true }) });
    const form = await openForm();
    const note = await within(form).findByText(/is banned until/u);
    expect(note.closest('p')).toHaveTextContent(/^Pipewrench is banned until .+\. The ban ends by itself then, and it holds only this character: switch to another in the HUD to post as it\./u);
    expect(within(form).queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(within(form).queryByRole('heading', { name: /can't post on General/u })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Write an apology' })).toBeNull();
  });
});
