/**
 * The set form's "Only when" group (docs/plans/2026-11-08-quote-conditions-plan.md, Task 7; the design's sections 1 to 4 and 7): an optional,
 * collapsed disclosure under the set summary, for a Move being set alone, with Says ("They say…"), Quotes ("They quote…") and Who (Anyone,
 * Only these, Anyone but these, with up to five removable chips). The request carries `when` only with a condition set, and the form's
 * refusals stand beside the field they belong to. The cards are the engine's test set; none is a Divided World card.
 */
import { readFileSync } from 'node:fs';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { decideSet, landsOn, ok, postTarget, refuse, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import { conditionWords, fieldOfRefusal } from './SetConditions.tsx';
import type { CardUi, ConfigFormProps } from './types.ts';

const base = { priceKey: 'x.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const blot: CardRules = { ...base, key: 'blot', name: 'Blot', alignment: 'salty', rarity: 'common', canApply: (t, e, _config, now) => landsOn({ key: 'blot' }, t, e, now) };
/** A Move with its own phrase, as Autocorrect has. */
const echo: CardRules = { ...base, key: 'echo', name: 'Echo', alignment: 'salty', rarity: 'common', canApply: () => ok(undefined),
  setPhrase: (c) => String((c as { phrase?: string } | undefined)?.phrase ?? ''),
  validateConfig: (c) => (typeof (c as { phrase?: unknown } | undefined)?.phrase === 'string' ? ok(c) : refuse('the phrase is text')) };
const snare: CardRules = { ...base, key: 'snare', name: 'Snare', alignment: 'salty', rarity: 'uncommon', play: 'set', trap: { trigger: { on: 'cast' } }, catches: (c) => (c as { card?: string }).card ?? '', canApply: () => ok(undefined),
  validateConfig: (c) => (typeof (c as { card?: unknown } | undefined)?.card === 'string' ? ok(c) : refuse('the card is the key of the card to catch')) };
const shield: CardRules = { ...base, key: 'shield', name: 'Shield', alignment: 'sweet', rarity: 'common', play: 'use', canApply: () => ok(undefined) };
const instance: Instance = { ...testInstance, cards: [blot, echo, snare, shield], settings: { ...testInstance.settings, economy: { 'x.price': 100 }, setLasts: { unit: 'day', count: 7 } } };

function Phrase({ config, onChange, id }: ConfigFormProps) {
  return (
    <label>Phrase
      <input id={`${id}-phrase`} value={String(config?.phrase ?? '')} onChange={(e) => onChange({ phrase: e.target.value })} />
    </label>
  );
}
function Pick({ config, onChange, id, castable }: ConfigFormProps) {
  return (
    <fieldset>
      <legend>The card it waits for</legend>
      {(castable ?? []).map((f) => <label key={f.key}><input type="radio" name={`${id}-catch`} aria-label={f.name} checked={config?.card === f.key} onChange={() => onChange({ card: f.key })} /></label>)}
    </fieldset>
  );
}
const art = (color: string) => ({ color, ink: '#000', canvas: '', mark: `/${color}.svg`, credit: 'Test' });
const cards: CardUi[] = [
  { key: 'blot', art: art('pink'), describe: () => 'Splats.' },
  { key: 'echo', art: art('cyan'), describe: () => 'Echoes.', ConfigForm: Phrase },
  { key: 'snare', art: art('red'), describe: () => 'Catches.', ConfigForm: Pick },
  { key: 'shield', art: art('green'), describe: () => 'Shields.' },
];

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const BODY = 'The punchline is nice, truly.\nA second line, with more words.';

/** Post 3 is the HUD's own (Pipewrench's); the others on the board are named by the combobox. */
function world(extra = 0) {
  const fake = buildWorld({ postMaxLength: 1000 }, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const boshi = fake.seed.character(other, 'Boshi', 'face');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const crowd = Array.from({ length: extra }, (_, i) => fake.seed.character(other, `Crowd ${'abcdefgh'[i]}`, 'face'));
  const { thread } = fake.seed.thread('general', gloomba, 'A thread', 'post 1');
  fake.seed.post(thread, gloomba, 'post 2');
  fake.seed.post(thread, pipe, BODY);
  fake.seed.cards(me, { blot: 3, echo: 3, snare: 1, shield: 1 });
  fake.seed.wallet(me, 462);
  fake.signInAs(me);
  localStorage.setItem(hudKey(me), pipe);
  return { fake, thread, pipe, gloomba, boshi, spritey, crowd };
}
async function open(w: ReturnType<typeof world>) {
  renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards, settings: { postMaxLength: 1000 } });
  await screen.findByRole('article', { name: /^Post 3 /u });
  await screen.findByRole('button', { name: /^Hand, \d+ postcards?/u });
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
async function armAndOpen(user: ReturnType<typeof userEvent.setup>, card: string, markName: string, seq: number) {
  await user.click(screen.getByRole('button', { name: /^Hand, \d+ postcards?/u }));
  await user.click(within(screen.getByRole('region', { name: 'Your hand' })).getAllByRole('button', { name: new RegExp(`^${card},`, 'u') })[0]!);
  await user.click(await within(post(seq)).findByRole('button', { name: markName }));
  return screen.findByRole('dialog');
}
/** A Move, set face down, with the disclosure open. */
async function setBlot(user: ReturnType<typeof userEvent.setup>, w: ReturnType<typeof world>) {
  await open(w);
  const dialog = await armAndOpen(user, 'Blot', 'Play Blot on post 3', 3);
  await user.click(within(dialog).getByRole('radio', { name: 'Set face down' }));
  return dialog;
}
const toggle = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /^Only when/u });
async function openGroup(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(toggle(dialog));
  return within(dialog).getByRole('group', { name: 'Only when' });
}
/** Chooses a character in the Who box by typing the start of the name. */
async function addWho(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, typed: string, name: RegExp) {
  const box = within(dialog).getByRole('combobox');
  await user.clear(box);
  await user.type(box, typed);
  await user.click(await within(dialog).findByRole('option', { name }));
}
/** Selects the words from `from` to `to` (offsets into the post's words) in the form's view of the post, as a pointer or the keyboard leaves them. */
function select(dialog: HTMLElement, from: number, to: number) {
  const view = dialog.querySelector('[data-kb-post-words]')!;
  const text = view.firstChild!;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  act(() => { document.dispatchEvent(new Event('selectionchange')); });
}

describe('where the group is', () => {
  test('a Move being set has it, collapsed: a button with aria-expanded false, and no field until it is opened', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const button = toggle(dialog);
    expect(button).toHaveTextContent('Only when… (optional)');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByLabelText('They say…')).toBeNull();
    expect(within(dialog).queryByLabelText('They quote…')).toBeNull();
    /* Under the set summary, above the end: the one-tap catch-all stays the default. */
    const order = [dialog.querySelector('[data-kb-sets]')!, button, dialog.querySelector('[data-kb-ends]')!];
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('is not on Play it now, a Gimmick or a Use', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Blot', 'Play Blot on post 3', 3);
    expect(within(dialog).queryByRole('button', { name: /^Only when/u })).toBeNull();
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    const gimmick = await armAndOpen(user, 'Snare', 'Set Snare face down on post 3', 3);
    expect(within(gimmick).queryByRole('button', { name: /^Only when/u })).toBeNull();
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    const use = await armAndOpen(user, 'Shield', 'Use Shield on post 3', 3);
    expect(within(use).queryByRole('button', { name: /^Only when/u })).toBeNull();
  });

  test('opens to three labeled fields: They say…, They quote… and Who (Anyone chosen), and closes again', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    expect(toggle(dialog)).toHaveAttribute('aria-expanded', 'true');
    expect(within(group).getByRole('textbox', { name: 'They say…' })).toHaveValue('');
    expect(within(group).getByRole('textbox', { name: 'They quote…' })).toHaveValue('');
    const who = within(group).getByRole('group', { name: 'Who' });
    expect(within(who).getByRole('radio', { name: 'Anyone' })).toBeChecked();
    expect(within(who).getByRole('radio', { name: 'Only these' })).not.toBeChecked();
    expect(within(who).getByRole('radio', { name: 'Anyone but these' })).not.toBeChecked();
    /* The trio is the glass's skewed shape: each option's words sit in an upright inner span that the skew's opposite holds straight. */
    for (const name of ['Anyone', 'Only these', 'Anyone but these']) {
      const face = within(who).getByRole('radio', { name }).nextElementSibling;
      expect(face, `${name}'s face`).toHaveClass('kb-play-choice-face');
      expect(face?.firstElementChild, `${name}'s upright words`).toHaveClass('kb-glass-upright');
    }
    expect(within(group).queryByRole('combobox')).toBeNull();
    await user.click(toggle(dialog));
    expect(toggle(dialog)).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByLabelText('They say…')).toBeNull();
  });

  test('a closed row still says how many conditions are set, and the summary reads them back', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.type(within(group).getByRole('textbox', { name: 'They say…' }), 'nice try');
    await user.type(within(group).getByRole('textbox', { name: 'They quote…' }), 'punchline');
    await user.click(toggle(dialog));
    expect(toggle(dialog)).toHaveTextContent('2 set');
    expect(dialog.querySelector('[data-kb-sets]')).toHaveTextContent('Springs when someone quotes “punchline” saying “nice try”, and lands on the quoting post.');
  });
});

describe('Says, on a card with its own phrase', () => {
  test('is locked and filled with the card\'s phrase, with a plain note', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    const dialog = await armAndOpen(user, 'Echo', 'Play Echo on post 3', 3);
    await user.click(within(dialog).getByRole('radio', { name: 'Set face down' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Phrase' }), 'oh really');
    const group = await openGroup(user, dialog);
    const says = within(group).getByRole('textbox', { name: 'They say…' });
    expect(says).toHaveValue('oh really');
    expect(says).toHaveAttribute('readonly');
    expect(group).toHaveTextContent('This card always waits for its own phrase');
    await user.type(says, 'zzz');
    expect(says).toHaveValue('oh really');
    /* The phrase follows the card's own setting. */
    await user.type(within(dialog).getByRole('textbox', { name: 'Phrase' }), '?');
    expect(says).toHaveValue('oh really?');
  });

  test('a set sends no Says of its own: the card\'s phrase is the rules\'', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    await open(w);
    const dialog = await armAndOpen(user, 'Echo', 'Play Echo on post 3', 3);
    await user.click(within(dialog).getByRole('radio', { name: 'Set face down' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Phrase' }), 'oh really');
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    await waitFor(() => expect(setCard).toHaveBeenCalledWith('echo', w.pipe, expect.any(String), { phrase: 'oh really' }));
  });
});

describe('They quote…', () => {
  test('shows the post\'s visible words, read-only, in a scrollable block; selecting some fills the field', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    const view = group.querySelector('[data-kb-post-words]')!;
    expect(view).toHaveTextContent('The punchline is nice, truly.');
    expect(view.getAttribute('tabindex')).toBe('0');
    expect(view.getAttribute('contenteditable')).toBeNull();
    select(dialog, 4, 13);
    expect(within(group).getByRole('textbox', { name: 'They quote…' })).toHaveValue('punchline');
  });

  test('a selection that runs over a line break keeps its first line, and says so', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    select(dialog, 14, 45);
    expect(within(group).getByRole('textbox', { name: 'They quote…' })).toHaveValue('is nice, truly.');
    expect(group).toHaveTextContent('A passage is one line');
  });

  test('a selection elsewhere on the page does not fill it, and the field can always be typed', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    const field = within(group).getByRole('textbox', { name: 'They quote…' });
    await user.type(field, 'nice');
    expect(field).toHaveValue('nice');
    const label = within(group).getByText('They say…');
    const range = document.createRange();
    range.selectNodeContents(label);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(field).toHaveValue('nice');
  });

  test('a passage that is not in the post is refused beside the field, and Set waits', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    const field = within(group).getByRole('textbox', { name: 'They quote…' });
    await user.type(field, 'banana');
    const why = document.getElementById(field.getAttribute('aria-describedby')!.split(' ').find((i) => document.getElementById(i)?.textContent?.includes('not in this post'))!)!;
    expect(why).toHaveTextContent("That passage is not in this post's words.");
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' })).toBeDisabled();
    await user.clear(field);
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' })).toBeEnabled();
  });
});

describe('Says, typed', () => {
  test('stops at a hundred characters and refuses a phrase with no letter or digit beside its field', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    const says = within(group).getByRole('textbox', { name: 'They say…' });
    expect(says).not.toHaveAttribute('maxlength');
    expect(group).toHaveTextContent('At most 100 characters.');
    await user.type(says, '!!');
    expect(says).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveTextContent('What they say needs a letter or a digit.');
    expect(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' })).toBeDisabled();
  });
});

describe('Who', () => {
  test('Only these shows the character box; each choice becomes a chip with a labeled remove button and a counter', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.click(within(group).getByRole('radio', { name: 'Only these' }));
    expect(within(group).getByRole('combobox', { name: 'Character' })).toBeInTheDocument();
    await addWho(user, dialog, 'Gloo', /Gloomba/u);
    await addWho(user, dialog, 'Bosh', /Boshi/u);
    const chips = within(group).getByRole('list', { name: 'Chosen characters' });
    expect(within(chips).getAllByRole('listitem').map((i) => i.textContent?.replace('×', '').trim())).toEqual(['Gloomba', 'Boshi']);
    expect(within(chips).getByRole('button', { name: 'Remove Boshi' })).toBeInTheDocument();
    expect(group).toHaveTextContent('2 of 5');
    expect(dialog.querySelector('[data-kb-sets]')).toHaveTextContent('Springs when Gloomba or Boshi quotes this post, and lands on the quoting post.');
  });

  test('Anyone but these reads back as "anyone but"', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.click(within(group).getByRole('radio', { name: 'Anyone but these' }));
    await addWho(user, dialog, 'Bosh', /Boshi/u);
    expect(dialog.querySelector('[data-kb-sets]')).toHaveTextContent('Springs when anyone but Boshi quotes this post, and lands on the quoting post.');
  });

  test('a character already chosen is not added twice, and it is said', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.click(within(group).getByRole('radio', { name: 'Only these' }));
    await addWho(user, dialog, 'Gloo', /Gloomba/u);
    await addWho(user, dialog, 'Gloo', /Gloomba/u);
    expect(within(group).getAllByRole('listitem')).toHaveLength(1);
    expect(group).toHaveTextContent('1 of 5');
    expect(within(group).getByRole('status', { name: 'Who was chosen' })).toHaveTextContent('Gloomba is already chosen.');
  });

  test('a sixth cannot be added: the box is disabled with a plain note, and a removal gives it back', async () => {
    const user = userEvent.setup();
    const w = world(5);
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.click(within(group).getByRole('radio', { name: 'Only these' }));
    await addWho(user, dialog, 'Gloo', /Gloomba/u);
    await addWho(user, dialog, 'Bosh', /Boshi/u);
    await addWho(user, dialog, 'Spri', /Spritey/u);
    await addWho(user, dialog, 'Crowd a', /Crowd a/u);
    await addWho(user, dialog, 'Crowd b', /Crowd b/u);
    expect(group).toHaveTextContent('5 of 5');
    expect(within(group).getByRole('combobox', { name: 'Character' })).toBeDisabled();
    expect(group).toHaveTextContent('Five is the most. Remove one to add another.');
    expect(within(group).getAllByRole('listitem')).toHaveLength(5);
    await user.click(within(group).getByRole('button', { name: 'Remove Crowd b' }));
    expect(within(group).getByRole('combobox', { name: 'Character' })).toBeEnabled();
    expect(group).toHaveTextContent('4 of 5');
  });

  test('a chip is removed by the keyboard, and focus goes on to the box', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.click(within(group).getByRole('radio', { name: 'Only these' }));
    await addWho(user, dialog, 'Gloo', /Gloomba/u);
    await addWho(user, dialog, 'Bosh', /Boshi/u);
    within(group).getByRole('button', { name: 'Remove Gloomba' }).focus();
    await user.keyboard('{Enter}');
    expect(within(group).queryByRole('button', { name: 'Remove Gloomba' })).toBeNull();
    expect(within(group).getByRole('button', { name: 'Remove Boshi' })).toHaveFocus();
    await user.keyboard(' ');
    expect(within(group).queryByRole('button', { name: 'Remove Boshi' })).toBeNull();
    expect(within(group).getByRole('combobox', { name: 'Character' })).toHaveFocus();
  });

  test('Anyone drops the list from the request; the chips return if the list is chosen again', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.click(within(group).getByRole('radio', { name: 'Only these' }));
    await addWho(user, dialog, 'Gloo', /Gloomba/u);
    await user.click(within(group).getByRole('radio', { name: 'Anyone' }));
    expect(within(group).queryByRole('combobox')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    await waitFor(() => expect(setCard).toHaveBeenCalledWith('blot', w.pipe, expect.any(String), {}));
  });

  test('Only these with nobody chosen waits, in words beside the field', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.click(within(group).getByRole('radio', { name: 'Only these' }));
    expect(group).toHaveTextContent('Name at least one character, or choose anyone.');
    expect(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' })).toBeDisabled();
  });
});

describe('the request', () => {
  test('carries no `when` with no condition set', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const dialog = await setBlot(user, w);
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    await waitFor(() => expect(setCard).toHaveBeenCalled());
    expect(setCard.mock.calls[0]).toHaveLength(4);
  });

  test('carries `when` with the conditions set, and the back keeps them for its setter to see', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.type(within(group).getByRole('textbox', { name: 'They say…' }), 'nice try');
    await user.type(within(group).getByRole('textbox', { name: 'They quote…' }), 'punchline');
    await user.click(within(group).getByRole('radio', { name: 'Anyone but these' }));
    await addWho(user, dialog, 'Bosh', /Boshi/u);
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    await waitFor(() => expect(setCard).toHaveBeenCalledWith('blot', w.pipe, expect.any(String), {}, { says: 'nice try', passage: 'punchline', who: { except: true, characters: [w.boshi] } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const set = (await w.fake.log()).cards.find((e) => e.kind === 'played');
    expect(set).toMatchObject({ phrase: 'nice try', passage: 'punchline', who: [w.boshi], whoExcept: true });
  });

  test('a refusal that comes back stands beside its field, not only in the form\'s alert; one it cannot place is the alert\'s', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.type(within(group).getByRole('textbox', { name: 'They quote…' }), 'punchline');
    setCard.mockResolvedValueOnce({ ok: false, error: "that passage is not in this post's words", field: 'config' });
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    const field = within(group).getByRole('textbox', { name: 'They quote…' });
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(group).toHaveTextContent("That passage is not in this post's words.");
    /* Typing again takes it back. */
    await user.type(field, ' ');
    expect(field).not.toHaveAttribute('aria-invalid');
    setCard.mockResolvedValueOnce({ ok: false, error: 'you hold no "blot" card; the Vending Machine sells them', field: 'config' });
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You hold no');
    expect(field).not.toHaveAttribute('aria-invalid');
  });
});

describe('the words', () => {
  test('conditionWords reads each combination back', () => {
    const names = (id: string) => ({ a: 'Spritey', b: 'Boshi' })[id] ?? 'someone';
    expect(conditionWords({}, names)).toBe('when someone quotes this post');
    expect(conditionWords({ passage: 'the punchline', says: 'nice try', who: { except: false, characters: ['a', 'b'] } }, names)).toBe('when Spritey or Boshi quotes “the punchline” saying “nice try”');
    expect(conditionWords({ who: { except: true, characters: ['b'] } }, names)).toBe('when anyone but Boshi quotes this post');
    expect(conditionWords({ says: 'x y' }, names)).toBe('when someone quotes this post saying “x y”');
  });

  test('fieldOfRefusal places the rules\' own refusals, read from decideSet itself', () => {
    const target = postTarget('p', 'post', BODY);
    const ask = (rules: CardRules, c: Parameters<typeof decideSet>[6], config: unknown = {}) => {
      const d = decideSet(rules, instance.settings, target, [], config, instance.cards, c);
      return d.ok ? null : d.why;
    };
    const says = ask(blot, { says: '!!' });
    const long = ask(blot, { says: 'x'.repeat(101) });
    const passage = ask(blot, { passage: 'banana' });
    const blank = ask(blot, { passage: '??' });
    const none = ask(blot, { who: { except: false, characters: [] } });
    const many = ask(blot, { who: { except: false, characters: ['1', '2', '3', '4', '5', '6'] } });
    const twice = ask(blot, { who: { except: false, characters: ['a', 'A'] } });
    const own = ask(echo, { says: 'x' }, { phrase: 'y' });
    expect([says, long, passage, blank, none, many, twice, own].every((w) => w !== null)).toBe(true);
    expect([says, long].map((w) => fieldOfRefusal(w!))).toEqual(['says', 'says']);
    expect([passage, blank].map((w) => fieldOfRefusal(w!))).toEqual(['passage', 'passage']);
    expect([none, many, twice].map((w) => fieldOfRefusal(w!))).toEqual(['who', 'who', 'who']);
    expect(fieldOfRefusal(own!)).toBe('says');
    expect(fieldOfRefusal('this post already holds a card face down')).toBeNull();
  });
});

describe('the Who trio is skewed like the glass tabs', () => {
  const css = readFileSync('engine/ui/cards/play.css', 'utf8');
  test('the face skews by the glass token and its words take the opposite', () => {
    expect(css).toMatch(/\.kb-play-who-row \.kb-play-choice-face \{[^}]*transform: skewX\(var\(--kb-glass-skew\)\);/u);
    expect(css).toMatch(/\.kb-play-who-row \.kb-glass-upright \{[^}]*transform: skewX\(calc\(var\(--kb-glass-skew\) \* -1\)\);/u);
  });
  test('the selected face keeps its check, and the focus ring is on the face', () => {
    expect(css).toMatch(/\.kb-play-who-row \.kb-play-choice-opt:has\(input:checked\) \.kb-glass-upright::before \{[^}]*content: /u);
    expect(css).toMatch(/\.kb-play-who-row \.kb-play-choice-opt:has\(input:focus-visible\) \.kb-play-choice-face \{[^}]*outline: /u);
  });
});

describe('review fixes for the set form\'s group', () => {
  test('aria-controls names the panel only while it exists', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    expect(toggle(dialog)).not.toHaveAttribute('aria-controls');
    const group = await openGroup(user, dialog);
    expect(toggle(dialog).getAttribute('aria-controls')).toBe(group.id);
    expect(document.getElementById(group.id)).toBe(group);
  });

  test('a phrase and a passage count code points: a hundred emoji fit, a hundred and twenty stop at a hundred', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    for (const name of ['They say…', 'They quote…']) {
      const field = within(group).getByRole('textbox', { name });
      expect(field).not.toHaveAttribute('maxlength');
      fireEvent.change(field, { target: { value: '\u{1F600}'.repeat(120) } });
      expect([...(field as HTMLInputElement).value]).toHaveLength(100);
    }
  });

  test('the hint does not promise keyboard selection, and says typing is always possible', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    expect(group).not.toHaveTextContent(/Shift|arrow/u);
    expect(group).toHaveTextContent('Select words below with a pointer or by touch, or type them.');
  });

  test('a selection that spills past the post\'s words is said so, plainly, and fills nothing', async () => {
    const user = userEvent.setup();
    const w = world();
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    const view = dialog.querySelector('[data-kb-post-words]')!;
    const range = document.createRange();
    range.setStart(view.firstChild!, 4);
    range.setEnd(within(group).getByText('Who', { selector: 'legend' }).firstChild!, 2);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(within(group).getByRole('textbox', { name: 'They quote…' })).toHaveValue('');
    expect(group).toHaveTextContent('Your selection went past the post\'s words, so nothing was taken. Select inside them.');
  });

  test('a refusal puts focus on its field even with the group closed; Who goes to the character box', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.type(within(group).getByRole('textbox', { name: 'They quote…' }), 'punchline');
    await user.click(toggle(dialog));
    setCard.mockResolvedValueOnce({ ok: false, error: "that passage is not in this post's words", field: 'config' });
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'They quote…' })).toHaveFocus());
    await user.click(within(dialog).getByRole('radio', { name: 'Only these' }));
    await addWho(user, dialog, 'Bosh', /Boshi/u);
    await user.click(toggle(dialog));
    setCard.mockResolvedValueOnce({ ok: false, error: 'name at most five characters', field: 'config' });
    await user.click(within(dialog).getByRole('button', { name: 'Set face down as Pipewrench' }));
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Character' })).toHaveFocus());
  });

  test('Enter in They say… or They quote… does not set the card', async () => {
    const user = userEvent.setup();
    const w = world();
    const setCard = vi.spyOn(w.fake, 'setCard');
    const dialog = await setBlot(user, w);
    const group = await openGroup(user, dialog);
    await user.type(within(group).getByRole('textbox', { name: 'They say…' }), 'nice{Enter}');
    await user.type(within(group).getByRole('textbox', { name: 'They quote…' }), 'punchline{Enter}');
    expect(setCard).not.toHaveBeenCalled();
    expect(within(group).getByRole('textbox', { name: 'They quote…' })).toHaveValue('punchline');
  });
});
