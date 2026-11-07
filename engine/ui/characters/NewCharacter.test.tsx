import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { NewCharacter } from './NewCharacter.tsx';
import type { ClassLook } from '../types.ts';

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

  test('previews what everyone will see, and shows no class unless "with its class" is chosen', async () => {
    open(world());
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    const preview = within(f).getByRole('group', { name: 'What everyone will see' });
    expect(preview).toHaveTextContent('Spritey debuts');
    expect(preview).toHaveTextContent(/At once/u);
    expect(preview).not.toHaveTextContent(/next settlement/u);
    expect(preview).not.toHaveTextContent(/Heel|Face/u);
    await userEvent.click(within(f).getByRole('radio', { name: /^Silent/u }));
    expect(preview).toHaveTextContent(/Nothing is posted/u);
    expect(preview).toHaveTextContent(/first post is its entrance/u);
    expect(preview).not.toHaveTextContent(/Heel|Face/u);
    await userEvent.click(within(f).getByRole('radio', { name: /^Debut at the settlement/u }));
    expect(preview).toHaveTextContent(/simply appears after the next settlement/u);
    await userEvent.click(within(f).getByRole('radio', { name: /^Announced, with its class/u }));
    expect(preview).toHaveTextContent('Spritey debuts as a Heel.');
  });

  test('opens with Drop now chosen, and announced', async () => {
    open(world());
    const f = await form();
    expect(within(f).getByRole('radio', { name: /^Drop now/u })).toBeChecked();
    expect(within(f).getByRole('radio', { name: /^Debut at the settlement/u })).not.toBeChecked();
    expect(within(f).getByRole('radio', { name: /^Announced\./u })).toBeChecked();
    expect(within(f).getByRole('group', { name: 'What everyone will see' })).toHaveTextContent(/At once/u);
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

  test('makes a character that waits to debut when the settlement is chosen, announced by default, and leaves the player on My characters', async () => {
    const w = world();
    const create = vi.spyOn(w.fake, 'createCharacter');
    open(w);
    const f = await form();
    const submit = within(f).getByRole('button', { name: 'Make the character' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    expect(submit).toBeDisabled();
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    await userEvent.click(within(f).getByRole('radio', { name: /^Debut at the settlement/u }));
    await userEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledWith('Spritey', 'heel', 'tally', 'announced'));
    await waitFor(() => expect(window.location.pathname).toBe('/characters'));
    const mine = await w.fake.myCharacters();
    expect(mine.find((c) => c.name === 'Spritey')).toMatchObject({ debutedAt: null, class: 'heel' });
    expect((await w.fake.characters(mine.map((c) => c.id))).map((c) => c.name)).toEqual(['Pipewrench']);
    /* My characters opens on the new one: the navigation carries it in history.state, never in the address. */
    expect(window.location.search + window.location.hash).toBe('');
    expect((window.history.state as { state: unknown }).state).toEqual({ character: mine.find((c) => c.name === 'Spritey')!.id });
  });

  test('drops at once, silently, with only the loudness changed', async () => {
    const w = world();
    const create = vi.spyOn(w.fake, 'createCharacter');
    open(w);
    const f = await form();
    await userEvent.type(within(f).getByLabelText('Name'), 'Spritey');
    await userEvent.click(within(f).getByRole('radio', { name: /^Face/u }));
    await userEvent.click(within(f).getByRole('radio', { name: /^Silent/u }));
    await userEvent.click(within(f).getByRole('button', { name: 'Make the character' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('Spritey', 'face', 'now', 'silent'));
    expect((await w.fake.myCharacters()).find((c) => c.name === 'Spritey')!.debutedAt).not.toBeNull();
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
    expect(/\.kb-debut,\s*\.kb-reveal\s*\{[^}]*gap:\s*var\(--kb-glass-section-gap\)/u.test(css)).toBe(true);
  });

  test('says in one line, beside Cancel and Make the character, what will happen, as the form is filled', async () => {
    open(world());
    const f = await form();
    const line = () => f.querySelector('.kb-glass-form-foot-line')!;
    expect(line()).toHaveTextContent('Your character is on the board as soon as you make it, and its own Promo announces it. Its class stays yours alone.');
    await userEvent.type(within(f).getByLabelText('Name'), 'Waiting Wanda');
    expect(line()).toHaveTextContent('Waiting Wanda is on the board as soon as you make it, and its own Promo announces it. Its class stays yours alone.');
    await userEvent.click(within(f).getByRole('radio', { name: /^Silent/u }));
    expect(line()).toHaveTextContent('Waiting Wanda is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays yours alone.');
    await userEvent.click(within(f).getByRole('radio', { name: /^Debut at the settlement/u }));
    expect(line()).toHaveTextContent('Waiting Wanda waits, seen by no one but you, and appears at the next settlement without a word. Its class stays yours alone.');
    await userEvent.click(within(f).getByRole('radio', { name: /^Announced, with its class/u }));
    expect(line()).toHaveTextContent("Waiting Wanda waits, seen by no one but you, and debuts at the next settlement, announced with the class you choose. That stays public, and can't be taken back.");
    await userEvent.click(within(f).getByRole('radio', { name: /^Heel/u }));
    expect(line()).toHaveTextContent("Waiting Wanda waits, seen by no one but you, and debuts at the next settlement, announced as a Heel. That stays public, and can't be taken back.");
    const foot = f.querySelector('.kb-glass-form-foot') as HTMLElement;
    expect(within(foot).getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/characters');
    expect(within(foot).getByRole('button', { name: 'Make the character' })).toBeEnabled();
  });
});

/* A class card is two facts: how the class earns, and under it what hurts it, set apart in the hurt color (the backfill design, section 5). */
describe('New character\'s class cards, earns and hurts', () => {
  test('set the description and then the hurt as two paragraphs, the second the hurt', async () => {
    open(world());
    const f = await form();
    const heel = within(f).getByRole('radio', { name: /^Heel/u }).closest('label')!;
    const earns = within(heel).getByText('Earns heat: boos and tomatoes.');
    const hurts = within(heel).getByText('Hurt by the polite shrug.');
    expect(earns).toHaveClass('kb-class-description');
    expect(hurts).toHaveClass('kb-class-hurt');
    expect(earns.nextElementSibling).toBe(hurts);
    expect(heel).not.toHaveTextContent('Earns heat: boos and tomatoes. Hurt by the polite shrug. Hurt by');
  });

  test('describe the radio by both, then the marks', async () => {
    open(world());
    const f = await form();
    expect(within(f).getByRole('radio', { name: /^Heel/u })).toHaveAccessibleDescription('Earns heat: boos and tomatoes. Hurt by the polite shrug. Earns from heat, hurt by the calm');
  });

  test('say nothing under a description for a class with no hurt', async () => {
    const looks: Readonly<Record<string, ClassLook>> = { face: { color: 'currentColor', description: () => 'Reads the room.', hurtsBy: () => '', marks: { label: 'Face marks', earns: [], hurts: [] } } };
    renderIn(world().fake, <NewCharacter />, { path: '/characters/new', classLooks: looks });
    const f = await form();
    expect(within(f).getByRole('radio', { name: /^Face/u }).closest('label')!.querySelector('.kb-class-hurt')).toBeNull();
  });
});

/* A class card's words are told the settlement span in force, as they are told the economy (#179). */
describe('New character\'s class cards', () => {
  test('pass the settlement span in force to each class\'s description', async () => {
    const looks: Readonly<Record<string, ClassLook>> = {
      face: { color: 'currentColor', description: (_e, span) => `Counts per window of ${span.count} ${span.unit}.`, hurtsBy: () => 'Hurt by nothing.', marks: { label: 'Face marks', earns: [], hurts: [] } },
    };
    const fake = buildWorld({ charactersPerPlayer: 3, settlementLength: { unit: 'week', count: 1 } });
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <NewCharacter />, { path: '/characters/new', settings: { charactersPerPlayer: 3, settlementLength: { unit: 'week', count: 1 } }, classLooks: looks });
    const f = await form();
    expect(within(f).getByText('Counts per window of 1 week.')).toBeInTheDocument();
  });
});

/* The carousel's five classes (the Technician plan's Task 4), in an instance of the test's own, since a test in engine/ui may not import one. */
describe('New character\'s classes', () => {
  test('offers every class in the instance\'s order, in one group, nothing chosen', async () => {
    const five: Instance = { ...testInstance, classes: ['Face', 'Heel', 'Jabroni', 'Technician', 'Lurker'].map((name) => ({ key: name.toLowerCase(), name, earn: () => [] })) };
    const fake = buildWorld({ charactersPerPlayer: 3 }, five);
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <NewCharacter />, { path: '/characters/new', settings: { charactersPerPlayer: 3 }, instance: five });
    const f = await form();
    const radios = within(within(f).getByRole('group', { name: /class/iu })).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['face', 'heel', 'jabroni', 'technician', 'lurker']);
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toEqual([]);
  });
});
