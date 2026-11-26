import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { NewCharacter } from './NewCharacter.tsx';
import { LoadedCharacters } from '../loaded.tsx';
import type { ClassLook } from '../types.ts';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function world(per = 3) {
  const fake = buildWorld({ charactersPerPlayer: per });
  const me = fake.seed.account('me');
  fake.seed.character(me, 'Pipewrench', 'face');
  fake.signInAs(me);
  return { fake, me, per };
}
const open = (w: ReturnType<typeof world>) => renderIn(w.fake, <NewCharacter />, { path: '/characters/new', settings: { charactersPerPlayer: w.per } });
const form = async () => screen.findByRole('form', { name: 'New character' });

describe('New character', () => {
  test('offers the class cards with the instance\'s descriptions', async () => {
    open(world());
    const f = await form();
    expect(within(f).getByRole('radio', { name: /^Face/u })).toBeInTheDocument();
    expect(within(f).getByRole('radio', { name: /^Heel/u })).toBeInTheDocument();
    expect(within(f).getByText('The crowd favorite: earns from cheers.')).toBeInTheDocument();
    expect(within(f).getByText('Earns heat: boos and tomatoes.')).toBeInTheDocument();
  });

  test('has no debut fields: no timing, no loudness, no preview of an announcement; the character is on the board at once', async () => {
    open(world());
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    for (const name of [/^Drop now/u, /^Debut at the settlement/u, /^Silent/u, /^Announced/u]) expect(within(f).queryByRole('radio', { name })).toBeNull();
    expect(within(f).queryByRole('group', { name: 'What everyone will see' })).toBeNull();
    expect(f).not.toHaveTextContent(/debut|Promo/iu);
    expect(f.querySelector('.kb-glass-form-foot-line')).toHaveTextContent('Spritey is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays yours alone.');
  });

  test('a character made without touching the timing has debuted and can post at once', async () => {
    const w = world();
    open(w);
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(f).getByRole('button', { name: 'Make the character' }));
    await waitFor(() => expect(window.location.pathname).toBe('/characters'));
    const made = (await w.fake.myCharacters()).find((c) => c.name === 'Spritey')!;
    expect(made.debutedAt).not.toBeNull();
    const thread = await w.fake.startThread('general', made.id, 'A thread', 'Hi.');
    expect(thread.ok).toBe(true);
  });

  test('My characters shows the new character at once, though Cancel read the roster ahead before it was made', async () => {
    const w = world();
    renderIn(w.fake, <LoadedCharacters />, { path: '/characters/new', settings: { charactersPerPlayer: w.per } });
    const f = await form();
    const roster = vi.spyOn(w.fake, 'myCharactersPage');
    /* A rest on Cancel reads My characters ahead, as a player passing over it on the way to the submit button does. */
    await userEvent.hover(within(f).getByRole('link', { name: 'Cancel' }));
    await waitFor(() => expect(roster).toHaveBeenCalledTimes(1));
    await roster.mock.results[0]!.value;
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(f).getByRole('button', { name: 'Make the character' }));
    await waitFor(() => expect(window.location.pathname).toBe('/characters'));
    expect(await screen.findByRole('tab', { name: /Spritey/u })).toBeInTheDocument();
  });

  test('makes the character with a name, a class and pronouns only, and leaves the player on My characters', async () => {
    const w = world();
    const create = vi.spyOn(w.fake, 'createCharacter');
    open(w);
    const f = await form();
    const submit = within(f).getByRole('button', { name: 'Make the character' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    expect(submit).toBeDisabled();
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledWith('Spritey', 'heel', PRONOUN_PRESETS.it));
    expect(create.mock.calls[0]).toHaveLength(3);
    await waitFor(() => expect(window.location.pathname).toBe('/characters'));
    const mine = await w.fake.myCharacters();
    expect(mine.find((c) => c.name === 'Spritey')).toMatchObject({ class: 'heel' });
    expect(mine.find((c) => c.name === 'Spritey')!.debutedAt).not.toBeNull();
    expect((await w.fake.characters(mine.map((c) => c.id))).map((c) => c.name).sort()).toEqual(['Pipewrench', 'Spritey']);
    /* My characters opens on the new one: the navigation carries it in history.state, never in the address. */
    expect(window.location.search + window.location.hash).toBe('');
    expect((window.history.state as { state: unknown }).state).toEqual({ character: mine.find((c) => c.name === 'Spritey')!.id });
  });

  test('starts on the instance\'s pronouns, makes the character with the ones chosen, and a bad custom set disables it', async () => {
    const w = world();
    const create = vi.spyOn(w.fake, 'createCharacter');
    open(w);
    const f = await form();
    expect(within(f).getByRole('radio', { name: /^it\/its/u })).toBeChecked();
    await userEvent.type(within(f).getByLabelText('Name'), 'Gloomba');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(f).getByRole('radio', { name: /^she\/her/u }));
    const submit = within(f).getByRole('button', { name: 'Make the character' });
    expect(submit).toBeEnabled();
    await userEvent.click(within(f).getByRole('radio', { name: /^Custom/u }));
    expect(submit).toBeEnabled();
    await userEvent.clear(within(f).getByLabelText('Subject'));
    expect(submit).toBeDisabled();
    await userEvent.type(within(f).getByLabelText('Subject'), 'abcdefghijklm');
    expect(within(f).getByText('the subject has 13 characters; at most 12')).toBeInTheDocument();
    await userEvent.click(within(f).getByRole('radio', { name: /^she\/her/u }));
    await userEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledWith('Gloomba', 'heel', PRONOUN_PRESETS.she));
    expect((await w.fake.myCharacters()).find((c) => c.name === 'Gloomba')!.pronouns).toEqual(PRONOUN_PRESETS.she);
  });

  test('starts on the screen settings\' pronouns when the instance sets them', async () => {
    const w = world();
    /* The backend's own screen settings carry it (the fake, as the screen_settings read does), and the screen starts there. */
    expect((await buildWorld({ pronouns: PRONOUN_PRESETS.she }).settings()).pronouns).toEqual(PRONOUN_PRESETS.she);
    renderIn(w.fake, <NewCharacter />, { path: '/characters/new', settings: { charactersPerPlayer: w.per, pronouns: PRONOUN_PRESETS.she } });
    const f = await form();
    expect(within(f).getByRole('radio', { name: /^she\/her/u })).toBeChecked();
    expect(within(f).getByRole('radio', { name: /^it\/its/u })).not.toBeChecked();
  });

  test('Make the character is a busy button while the create is out: aria-busy, its name kept, and a second press makes one character', async () => {
    const w = world();
    let release!: () => void;
    const real = w.fake.createCharacter.bind(w.fake);
    const create = vi.spyOn(w.fake, 'createCharacter').mockImplementation((...args) => new Promise((resolve) => { release = () => resolve(real(...args)); }));
    open(w);
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    const submit = within(f).getByRole('button', { name: 'Make the character' });
    await userEvent.click(submit);
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(within(f).getByRole('button', { name: 'Make the character' })).toBe(submit);
    await userEvent.click(submit);
    expect(create).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(window.location.pathname).toBe('/characters'));
  });

  test('shows a refusal in the server\'s words and keeps what was typed', async () => {
    open(world());
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Pipewrench');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(f).getByRole('button', { name: 'Make the character' }));
    expect(await within(f).findByRole('alert')).toHaveTextContent('that name is taken');
    expect(within(f).getByLabelText('Name')).toHaveValue('Pipewrench');
  });

  test('on a full roster says so, and that an admin can retire a character on request', async () => {
    open(world(1));
    expect(await screen.findByText(/an admin can retire a character on request/iu)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New character' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to your characters' })).toHaveAttribute('href', '/characters');
  });
});

/* The Turn board's footer, the lead under the title, and the name's count (the New character board). */
describe('New character\'s head, name and foot', () => {
  test('holds Make the character while the name is past the most, as Reveal holds its own over a count, and frees it again', async () => {
    open(world());
    const f = await form();
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.type(within(f).getByLabelText('Name'), 'x'.repeat(41));
    const make = within(f).getByRole('button', { name: 'Make the character' });
    expect(f.querySelector('.kb-glass-field-tally')).toHaveTextContent('41 of 40');
    expect(make).toBeDisabled();
    await userEvent.type(within(f).getByLabelText('Name'), '{Backspace}');
    expect(make).toBeEnabled();
  });

  test('sets the lead under the title, in the page head', async () => {
    open(world());
    await form();
    const lead = screen.getByText('This page is out of character and only you can see it. Nobody else can tell who plays a character.');
    expect(lead.closest('.kb-page-head')).toHaveAttribute('data-kb-lead', 'under');
  });

  test('counts the name beside its hint, on a line of its own the name is described by', async () => {
    open(world());
    const f = await form();
    const name = within(f).getByLabelText('Name');
    await userEvent.type(name, 'Waiting Wanda');
    expect(name).toHaveAccessibleDescription('Letters, marks, digits and single spaces. Names are unique, look-alikes included. 13 of 40');
  });

  test('sets each section a section gap from the next in one flex column', () => {
    const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'characters.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/\.kb-new-form\s*\{[^}]*gap:\s*var\(--kb-glass-section-gap\)/u.test(css)).toBe(true);
    expect(/\.kb-reveal\s*\{[^}]*gap:\s*var\(--kb-glass-section-gap\)/u.test(css)).toBe(true);
  });

  test('every line about the new character follows the pronouns chosen on the form: she/her, then they/them', async () => {
    open(world());
    const f = await form();
    const line = () => f.querySelector('.kb-glass-form-foot-line')!;
    await userEvent.type(within(f).getByLabelText('Name'), 'Waiting Wanda');
    await userEvent.click(within(f).getByRole('radio', { name: /^she\/her/u }));
    expect(within(f).getByText('Only you will know her class, unless you choose to reveal it.')).toBeInTheDocument();
    expect(line()).toHaveTextContent('Waiting Wanda is on the board as soon as you make her. Nobody is told, and her first post is her entrance. Her class stays yours alone.');
    await userEvent.click(within(f).getByRole('radio', { name: /^they\/them/u }));
    expect(within(f).getByText('Only you will know their class, unless you choose to reveal it.')).toBeInTheDocument();
    expect(line()).toHaveTextContent('Waiting Wanda is on the board as soon as you make them. Nobody is told, and their first post is their entrance. Their class stays yours alone.');
  });

  test('says in one line, beside Cancel and Make the character, what will happen, as the form is filled', async () => {
    open(world());
    const f = await form();
    const line = () => f.querySelector('.kb-glass-form-foot-line')!;
    expect(line()).toHaveTextContent('Your character is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays yours alone.');
    await userEvent.type(within(f).getByLabelText('Name'), 'Waiting Wanda');
    expect(line()).toHaveTextContent('Waiting Wanda is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays yours alone.');
    const foot = f.querySelector('.kb-glass-form-foot') as HTMLElement;
    expect(within(foot).getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/characters');
    expect(within(foot).getByRole('button', { name: 'Make the character' })).toBeDisabled();
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    expect(within(foot).getByRole('button', { name: 'Make the character' })).toBeEnabled();
  });
});
