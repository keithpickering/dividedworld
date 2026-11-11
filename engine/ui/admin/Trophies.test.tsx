import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { TrophiesScreen } from './Trophies.tsx';

/* The test catalog (P1 to P3, Met) plus a belt, and one piece of gear. */
const shop: Instance = {
  ...testInstance,
  gear: [{ key: 'band', name: 'Headband', line: 'Holds a thought in place.', rarity: 'common' }, { key: 'tall', name: 'Tall Hat', line: 'Tall.', rarity: 'rare' }],
  trophies: { ...testInstance.trophies, kinds: [...testInstance.trophies.kinds, { key: 'belt', name: 'The Belt', belt: true }] },
};

interface World { readonly fake: Fake; readonly pipe: string; readonly bones: string; readonly ana: string }

/** An admin signed in, with two characters of a player to give things to. */
function world(as: 'admin' | 'player' = 'admin'): World {
  const fake = buildWorld(undefined, shop);
  const root = fake.seed.account('root', { admin: true });
  const ana = fake.seed.account('ana');
  const pipe = fake.seed.character(ana, 'Pipewrench', 'heel');
  const bones = fake.seed.character(ana, 'Dr. Bones', 'face');
  fake.signInAs(as === 'admin' ? root : ana);
  return { fake, pipe, bones, ana };
}
const open = (w: World, makeArt?: (file: File) => Promise<Blob>) => renderIn(w.fake, <TrophiesScreen {...(makeArt ? { makeArt } : {})} />, { instance: shop, path: '/admin/trophies' });
const section = async (name: string) => screen.findByRole('region', { name });
const rows = async () => (await within(await section('Recent awards')).findAllByRole('row')).slice(1);

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the trophies admin page', () => {
  test('a player is told it is for admins, and nothing is asked for', async () => {
    const w = world('player');
    const asked = vi.spyOn(w.fake, 'adminAwards');
    const failures = vi.spyOn(w.fake, 'trophyAwardFailures');
    open(w);
    expect(await screen.findByText('The trophies page is for admins.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 40));
    expect(asked).not.toHaveBeenCalled();
    expect(failures).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Award' })).toBeNull();
  });

  test('a player who calls the admin reads and writes is refused, as the database refuses', async () => {
    const w = world('player');
    expect(await w.fake.adminAwards()).toMatchObject({ ok: false, error: expect.stringMatching(/only an admin/u) });
    expect(await w.fake.adminCharacterNamed('Pipewrench')).toMatchObject({ ok: false, error: expect.stringMatching(/only an admin/u) });
    expect(await w.fake.grantGear(w.pipe, 'band', 1)).toMatchObject({ ok: false });
  });

  test('shares the admin pages\' strip, with Trophies as the current page', async () => {
    open(world());
    const strip = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(within(strip).getByRole('link', { name: 'Trophies' })).toHaveAttribute('aria-current', 'page');
    expect(within(strip).getByRole('link', { name: 'Trophies' })).toHaveAttribute('href', '/admin/trophies');
  });

  test('recent awards are listed newest first with the trophy, the character and who gave it in plain words', async () => {
    const w = world();
    w.fake.seed.award(w.bones, 'p1', { by: 'season', at: Date.parse('2026-10-01T00:00:00Z') });
    w.fake.seed.award(w.pipe, 'belt', { by: 'admin', at: Date.parse('2026-10-30T00:00:00Z') });
    open(w);
    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r[0]).toHaveTextContent('The Belt');
    expect(r[0]).toHaveTextContent('Pipewrench');
    expect(r[0]).toHaveTextContent('An admin');
    expect(r[1]).toHaveTextContent('P1');
    expect(r[1]).toHaveTextContent('Dr. Bones');
    expect(r[1]).toHaveTextContent('The season');
  });

  test('awarding a trophy to a character by name gives it, says so, and lists it', async () => {
    const w = world();
    const given = vi.spyOn(w.fake, 'awardTrophy');
    open(w);
    const form = await section('Award a trophy');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Trophy' }), 'P2');
    await userEvent.type(within(form).getByRole('textbox', { name: 'To the character' }), 'pipewrench');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Its line (optional)' }), 'Best walk cycle.');
    await userEvent.click(within(form).getByRole('button', { name: 'Award' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Gave P2 to Pipewrench.'));
    expect(given).toHaveBeenCalledWith('p2', w.pipe, 'Best walk cycle.');
    expect((await rows())[0]).toHaveTextContent('Pipewrench');
    expect((await w.fake.trophies(w.pipe)).awards.map((a) => a.line)).toEqual(['Best walk cycle.']);
  });

  test('a belt says it passes to the character, and a trophy that is no belt does not', async () => {
    open(world());
    const form = await section('Award a trophy');
    const pick = within(form).getByRole('combobox', { name: 'Trophy' });
    expect(within(form).queryByText(/passes to this character/u)).toBeNull();
    await userEvent.selectOptions(pick, 'The Belt (belt)');
    expect(within(form).getByText(/passes to this character/u)).toBeInTheDocument();
    await userEvent.selectOptions(pick, 'P1');
    expect(within(form).queryByText(/passes to this character/u)).toBeNull();
  });

  test('a name no character has is said plainly and nothing is given', async () => {
    const w = world();
    const given = vi.spyOn(w.fake, 'awardTrophy');
    open(w);
    const form = await section('Award a trophy');
    await userEvent.type(within(form).getByRole('textbox', { name: 'To the character' }), 'Nobody Atall');
    await userEvent.click(within(form).getByRole('button', { name: 'Award' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('There is no character named Nobody Atall.');
    expect(given).not.toHaveBeenCalled();
  });

  test('the server\'s refusal is shown in its words (a staff character is never given a trophy)', async () => {
    const w = world();
    vi.spyOn(w.fake, 'awardTrophy').mockResolvedValue({ ok: false, error: 'a staff character is never given a trophy' });
    open(w);
    const form = await section('Award a trophy');
    await userEvent.type(within(form).getByRole('textbox', { name: 'To the character' }), 'Pipewrench');
    await userEvent.click(within(form).getByRole('button', { name: 'Award' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('a staff character is never given a trophy');
  });

  test('granting gear gives copies to whoever plays the character, and never says who that is', async () => {
    const w = world();
    const granted = vi.spyOn(w.fake, 'grantGear');
    open(w);
    const form = await section('Grant gear');
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Gear' }), 'Tall Hat');
    await userEvent.type(within(form).getByRole('textbox', { name: 'To the character' }), 'Dr. Bones');
    await userEvent.clear(within(form).getByRole('spinbutton', { name: 'Copies' }));
    await userEvent.type(within(form).getByRole('spinbutton', { name: 'Copies' }), '5');
    expect(within(form).getByText(/never says who that is/u)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Grant' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Gave 5 Tall Hat to Dr. Bones.'));
    expect(granted).toHaveBeenCalledWith(w.bones, 'tall', 5);
    expect(within(form).getByRole('status').textContent).not.toMatch(/ana|account/iu);
  });

  test('copies are 1 to 100: a grant outside is refused on the page and nothing is sent', async () => {
    const w = world();
    const granted = vi.spyOn(w.fake, 'grantGear');
    open(w);
    const form = await section('Grant gear');
    await userEvent.type(within(form).getByRole('textbox', { name: 'To the character' }), 'Dr. Bones');
    for (const bad of ['0', '101', '2.5']) {
      await userEvent.clear(within(form).getByRole('spinbutton', { name: 'Copies' }));
      await userEvent.type(within(form).getByRole('spinbutton', { name: 'Copies' }), bad);
      await userEvent.click(within(form).getByRole('button', { name: 'Grant' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent('Copies are a whole number from 1 to 100.');
    }
    expect(granted).not.toHaveBeenCalled();
  });

  test('making a trophy sends the picture the browser made, with its kind, and the new trophy can be awarded', async () => {
    const w = world();
    const made = vi.spyOn(w.fake, 'makeTrophy');
    const webp = new Blob(['webp'], { type: 'image/webp' });
    const makeArt = vi.fn(async () => webp);
    open(w, makeArt);
    const form = await section('Make a trophy');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Sprite Contest 2026');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Its line (optional)' }), 'Best sprite.');
    await userEvent.upload(within(form).getByLabelText(/^Picture/u), new File(['png'], 'sprite.png', { type: 'image/png' }));
    await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Kind' }), 'A belt (one holder at a time)');
    await userEvent.click(within(form).getByRole('button', { name: 'Make it' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Made Sprite Contest 2026.'));
    expect(makeArt).toHaveBeenCalledTimes(1);
    expect(made).toHaveBeenCalledWith('Sprite Contest 2026', 'Best sprite.', webp, true);
    const award = await section('Award a trophy');
    expect(within(award).getByRole('option', { name: 'Sprite Contest 2026 (belt, made here)' })).toBeInTheDocument();
  });

  test('a picture the browser could not make is said in words and nothing is made', async () => {
    const w = world();
    const made = vi.spyOn(w.fake, 'makeTrophy');
    open(w, async () => { throw new Error('That file is not a picture this browser can read.'); });
    const form = await section('Make a trophy');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Odd');
    await userEvent.upload(within(form).getByLabelText(/^Picture/u), new File(['x'], 'broken.png', { type: 'image/png' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Make it' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('That file is not a picture this browser can read.');
    expect(made).not.toHaveBeenCalled();
  });

  test('a trophy may be made with no picture', async () => {
    const w = world();
    const made = vi.spyOn(w.fake, 'makeTrophy');
    open(w);
    const form = await section('Make a trophy');
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Plain');
    await userEvent.click(within(form).getByRole('button', { name: 'Make it' }));
    await waitFor(() => expect(made).toHaveBeenCalledWith('Plain', null, null, false));
  });

  test('reversing a belt says what happens to the belt, truthfully: it goes back to whoever held it before, if anyone did', async () => {
    const w = world();
    w.fake.seed.award(w.pipe, 'belt', { by: 'admin', at: Date.parse('2026-10-01T00:00:00Z') });
    w.fake.seed.award(w.bones, 'p1', { by: 'admin', at: Date.parse('2026-10-02T00:00:00Z') });
    open(w);
    const beltRow = (await rows()).find((r) => r.textContent?.includes('The Belt'))!;
    await userEvent.click(within(beltRow).getByRole('button', { name: /^Reverse/u }));
    const said = await within(await section('Recent awards')).findByText(/^Took back The Belt from Pipewrench/u);
    expect(said).toHaveTextContent('If the belt was theirs, it goes back to whoever held it before, if anyone did.');
    expect(said.textContent).not.toMatch(/returns to the holder/u);
    const plain = (await rows()).find((r) => r.textContent?.includes('P1'))!;
    await userEvent.click(within(plain).getByRole('button', { name: /^Reverse/u }));
    expect(await within(await section('Recent awards')).findByText('Took back P1 from Dr. Bones.')).toBeInTheDocument();
  });

  test('Reverse takes an award back and the list keeps its other rows, the reversed one marked and with no button', async () => {
    const w = world();
    const first = w.fake.seed.award(w.bones, 'p1', { by: 'season', at: Date.parse('2026-10-01T00:00:00Z') });
    w.fake.seed.award(w.pipe, 'p2', { by: 'admin', at: Date.parse('2026-10-30T00:00:00Z') });
    open(w);
    const before = await rows();
    expect(before).toHaveLength(2);
    await userEvent.click(within(before[1]!).getByRole('button', { name: 'Reverse P1 given to Dr. Bones' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Recent awards' })).getAllByRole('row').slice(1)[1]).toHaveTextContent('Taken back'));
    const after = await rows();
    expect(after).toHaveLength(2);
    expect(after[0]).toHaveTextContent('P2');
    expect(within(after[0]!).getByRole('button', { name: /^Reverse/u })).toBeInTheDocument();
    expect(within(after[1]!).queryByRole('button')).toBeNull();
    expect((await w.fake.trophies(w.bones)).awards.some((a) => a.award === first)).toBe(false);
  });

  test('a refused reversal is said and the row stays as it was', async () => {
    const w = world();
    w.fake.seed.award(w.pipe, 'p1', { by: 'admin' });
    vi.spyOn(w.fake, 'reverseAward').mockResolvedValue({ ok: false, error: 'that trophy was already taken back' });
    open(w);
    await userEvent.click(within((await rows())[0]!).getByRole('button', { name: /^Reverse/u }));
    expect(await within(await section('Recent awards')).findByRole('alert')).toHaveTextContent('that trophy was already taken back');
    expect(within((await rows())[0]!).getByRole('button', { name: /^Reverse/u })).toBeInTheDocument();
  });

  test('awards that could not be given are listed with their error, and one can be given by hand', async () => {
    const w = world();
    w.fake.seed.awardFailure({ move: 'act-1', season: null, at: '2026-10-14T00:00:00.000Z', error: 'a database error (23505)', trophy: 'met', characters: [{ id: w.pipe, name: 'Pipewrench' }, { id: w.bones, name: 'Dr. Bones' }] });
    w.fake.seed.awardFailure({ move: null, season: 1, at: '2026-10-10T00:00:00.000Z', error: 'poisoned', trophy: null, characters: [{ id: w.bones, name: 'Dr. Bones', place: 2 }] });
    open(w);
    const list = await section('Awards that could not be given');
    expect(within(list).getByText('a database error (23505)')).toBeInTheDocument();
    expect(within(list).getByText(/Season 1/u)).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Give Met to Pipewrench' }));
    await waitFor(() => expect(within(list).getByRole('status')).toHaveTextContent('Gave Met to Pipewrench.'));
    expect((await w.fake.trophies(w.pipe)).awards.map((a) => a.trophy)).toEqual(['met']);
    /* A season's failure names no trophy: the place's own (P2 for second) is given. */
    await userEvent.click(within(list).getByRole('button', { name: 'Give P2 to Dr. Bones' }));
    await waitFor(() => expect(within(list).getByRole('status')).toHaveTextContent('Gave P2 to Dr. Bones.'));
  });

  test('a character given by hand shows "Given" with no button, so it cannot be given twice, and Recent awards show it at once', async () => {
    const w = world();
    w.fake.seed.awardFailure({ move: 'act-1', season: null, at: '2026-10-14T00:00:00.000Z', error: 'a database error (23505)', trophy: 'met', characters: [{ id: w.pipe, name: 'Pipewrench' }, { id: w.bones, name: 'Dr. Bones' }] });
    const give = vi.spyOn(w.fake, 'giveFailedAward');
    open(w);
    const list = await section('Awards that could not be given');
    expect(await within(await section('Recent awards')).findByText('No trophy has been given yet.')).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Give Met to Pipewrench' }));
    await waitFor(() => expect(within(list).getByText('Given: Met to Pipewrench')).toBeInTheDocument());
    expect(within(list).queryByRole('button', { name: 'Give Met to Pipewrench' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Give Met to Dr. Bones' })).toBeInTheDocument();
    expect(give).toHaveBeenCalledTimes(1);
    expect(give).toHaveBeenCalledWith(expect.any(String), w.pipe);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveTextContent('Pipewrench');
    /* It stays given when the page is read again. */
    cleanup();
    open(w);
    const again = await section('Awards that could not be given');
    expect(await within(again).findByText('Given: Met to Pipewrench')).toBeInTheDocument();
    expect(within(again).queryByRole('button', { name: 'Give Met to Pipewrench' })).toBeNull();
    expect((await w.fake.trophies(w.pipe)).awards).toHaveLength(1);
  });

  test('a failure with everything given goes behind the unresolved ones, which come first', async () => {
    const w = world();
    w.fake.seed.awardFailure({ move: 'old', season: null, at: '2026-10-01T00:00:00.000Z', error: 'oldest, still owed', trophy: 'met', characters: [{ id: w.pipe, name: 'Pipewrench' }] });
    w.fake.seed.awardFailure({ move: 'new', season: null, at: '2026-10-20T00:00:00.000Z', error: 'newest, done', trophy: 'met', characters: [{ id: w.bones, name: 'Dr. Bones' }] });
    open(w);
    const list = await section('Awards that could not be given');
    const order = () => within(list).getAllByRole('listitem').map((li) => (li.textContent ?? '').includes('done') ? 'done' : 'owed');
    expect(order()).toEqual(['done', 'owed']);
    await userEvent.click(within(list).getByRole('button', { name: 'Give Met to Dr. Bones' }));
    await waitFor(() => expect(order()).toEqual(['owed', 'done']));
  });

  test('the failures are fetched a page at a time', async () => {
    const w = world();
    for (let i = 0; i < 52; i += 1) w.fake.seed.awardFailure({ move: `m${i}`, season: null, at: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60_000).toISOString(), error: `err ${i}`, trophy: 'met', characters: [{ id: w.pipe, name: 'Pipewrench' }] });
    open(w);
    const list = await section('Awards that could not be given');
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(50));
    await userEvent.click(within(list).getByRole('button', { name: 'Older failed awards' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(52));
    expect(within(list).queryByRole('button', { name: 'Older failed awards' })).toBeNull();
  });

  test('a refused give says why and keeps its button', async () => {
    const w = world();
    w.fake.seed.awardFailure({ move: 'act-1', season: null, at: '2026-10-14T00:00:00.000Z', error: 'e', trophy: 'met', characters: [{ id: w.pipe, name: 'Pipewrench' }] });
    vi.spyOn(w.fake, 'giveFailedAward').mockResolvedValue({ ok: false, error: 'that award was already given to that character' });
    open(w);
    const list = await section('Awards that could not be given');
    await userEvent.click(within(list).getByRole('button', { name: 'Give Met to Pipewrench' }));
    expect(await within(list).findByRole('alert')).toHaveTextContent('that award was already given to that character');
  });

  test('with no failures it says so', async () => {
    open(world());
    expect(await within(await section('Awards that could not be given')).findByText('No award has failed.')).toBeInTheDocument();
  });

  test('older awards are fetched a page at a time', async () => {
    const w = world();
    for (let i = 0; i < 23; i += 1) w.fake.seed.award(w.pipe, 'p1', { by: 'admin', at: Date.parse('2026-10-01T00:00:00Z') + i * 60_000 });
    open(w);
    expect(await rows()).toHaveLength(20);
    await userEvent.click(within(await section('Recent awards')).getByRole('button', { name: 'Older awards' }));
    await waitFor(async () => expect(await rows()).toHaveLength(23));
    expect(within(await section('Recent awards')).queryByRole('button', { name: 'Older awards' })).toBeNull();
  });

  test('it has no axe violations', async () => {
    const w = world();
    w.fake.seed.award(w.pipe, 'p1', { by: 'admin' });
    const { container } = open(w);
    await rows();
    expect(describeViolations(await axeViolations(container))).toBe('');
  });
});
