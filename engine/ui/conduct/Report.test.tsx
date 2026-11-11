/**
 * Report to admins (docs/plans/2026-11-02-conduct-plan.md, Task 6; the boards in docs/research/2026-11-02-conduct/): a plain text link at the foot of a post's Lens and on each
 * version in its History, which both open one dialog naming the version. The form sends `report_post`; its states (sent, the open-report limit, an error that keeps what was typed)
 * stand in the dialog, each with focus on its heading, in plain words that never lean on a color.
 */
import { readFileSync } from 'node:fs';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { LoadedThread } from '../loaded.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const mine = fake.seed.post(thread, pipe, 'post 3 is mine');
  fake.signInAs(me);
  return { fake, me, other, pipe, spritey, thread, second, mine };
}
type World = ReturnType<typeof world>;
const open = (w: World) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}` });
const article = (seq: number) => screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });

/** The Lens of post 2, open on the board's Report tab. */
async function lens(w: World) {
  open(w);
  await userEvent.click(await within(await article(2)).findByRole('button', { name: 'Report' }));
  return screen.findByRole('dialog', { name: 'Report this post' });
}
const entry = (panel: HTMLElement) => within(panel).getByRole('button', { name: 'Report to admins' });
/** The dialog's own foot: its Cancel, Send and Close, apart from the frame's cross (which is a Close too). */
const foot = (dialog: HTMLElement) => dialog.querySelector('.kb-glass-form-foot') as HTMLElement;
/** The report dialog, opened from the Lens's foot link. */
async function dialogFrom(w: World) {
  const panel = await lens(w);
  await userEvent.click(entry(panel));
  return screen.findByRole('dialog', { name: 'Report to admins' });
}

describe('Report to admins on the Lens', () => {
  test('is a plain button at the very foot of the Lens\'s body, under a rule, and never a tab', async () => {
    const panel = await lens(world());
    const link = entry(panel);
    const body = panel.querySelector('.kb-lens-body')!;
    expect(body.lastElementChild).toContainElement(link);
    expect(link.closest('.kb-report-foot')).not.toBeNull();
    expect(link).toHaveAttribute('aria-haspopup', 'dialog');
    expect(within(panel).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Report post #2']);
    /* The board's own Report form is unchanged, and the plain link is not a mark, a chip or a glass button. */
    expect(within(panel).getByRole('button', { name: /^Report ·/u })).toBeInTheDocument();
    expect(link.className).not.toMatch(/kb-(?:glass-button|mark|chip|button)\b/u);
  });

  test('opens the dialog naming the version: the post, its author and the current version', async () => {
    const w = world();
    const dialog = await dialogFrom(w);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Report to admins' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Post #2 by Spritey, current version');
  });
});

describe('Report to admins on each version in History', () => {
  test('each version of a post carries the plain link, named for its version', async () => {
    const w = world();
    /* Post 2 is Spritey's: edit it as Spritey so it has two versions. */
    w.fake.signInAs(w.other);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.second, w.spritey, 'post 2, fixed');
    w.fake.signInAs(w.me);
    open(w);
    const art = await article(2);
    await userEvent.click(within(art).getByRole('button', { name: 'History' }));
    const list = await within(art).findByRole('list', { name: 'Versions of this post, oldest first' });
    const links = within(list).getAllByRole('button', { name: /^Report to admins/u });
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual(['Report to admins: original', 'Report to admins: edit 1']);
    expect(links.map((l) => l.textContent)).toEqual(['Report to admins', 'Report to admins']);
    await userEvent.click(links[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Report to admins' });
    expect(dialog).toHaveTextContent('Post #2 by Spritey, original');
  });

  test('a post of the reader\'s own mask has the link in its History too: the server takes a report on one\'s own post', async () => {
    const w = world();
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.mine, w.pipe, 'post 3, fixed');
    open(w);
    const art = await article(3);
    await userEvent.click(within(art).getByRole('button', { name: 'History' }));
    const list = await within(art).findByRole('list', { name: 'Versions of this post, oldest first' });
    expect(within(list).getAllByRole('button', { name: /^Report to admins/u })).toHaveLength(2);
  });

  test('a version\'s link reports that version, not the post\'s current one', async () => {
    const w = world();
    w.fake.signInAs(w.other);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.second, w.spritey, 'post 2, fixed');
    w.fake.signInAs(w.me);
    const send = vi.spyOn(w.fake, 'reportPost');
    open(w);
    const art = await article(2);
    await userEvent.click(within(art).getByRole('button', { name: 'History' }));
    await userEvent.click(await within(art).findByRole('button', { name: 'Report to admins: original' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report to admins' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /No hate/u }));
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(w.second, 'hate', '');
  });
});

describe('the report dialog', () => {
  test('lists the code\'s sections as radios, each with a Read link to /conduct#key, and a note with a live count', async () => {
    const dialog = await dialogFrom(world());
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['person', 'hate']);
    expect(within(dialog).getByRole('group', { name: 'Which part of the code of conduct' })).toBeInTheDocument();
    /* Each opens the code in a new tab, so the note being typed survives, and says so in its name. */
    const read = within(dialog).getByRole('link', { name: 'Read: No hate. (opens in a new tab)' });
    expect(read).toHaveAttribute('href', '/conduct#hate');
    expect(read).toHaveAttribute('target', '_blank');
    expect(read).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(within(dialog).getByRole('link', { name: 'Read: The mask is fair game. (opens in a new tab)' })).toHaveAttribute('href', '/conduct#person');
    expect(dialog).toHaveTextContent('This reaches a person, not the game. An admin reads every report, and the player is never told who sent it.');
    const note = within(dialog).getByRole('textbox', { name: 'Anything an admin should know (optional)' });
    expect(dialog).toHaveTextContent('0 of 1000');
    await userEvent.type(note, 'a few words');
    expect(dialog).toHaveTextContent('11 of 1000');
    expect(within(foot(dialog)).getByRole('button', { name: 'Send to admins' })).toHaveAttribute('data-kb-kind', 'secondary');
    expect(within(foot(dialog)).getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-kb-kind', 'quiet');
  });

  test('Send to admins is held until a section is chosen, and says so', async () => {
    const w = world();
    const send = vi.spyOn(w.fake, 'reportPost');
    const dialog = await dialogFrom(w);
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    expect(send).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose the part of the code this breaks.');
  });

  test('sends report_post with the version, the section and the note, then says it is sent, plainly, with focus on its heading', async () => {
    const w = world();
    const send = vi.spyOn(w.fake, 'reportPost');
    const dialog = await dialogFrom(w);
    await userEvent.click(within(dialog).getByRole('radio', { name: /No hate/u }));
    await userEvent.type(within(dialog).getByRole('textbox'), 'the last line');
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(w.second, 'hate', 'the last line'));
    expect(await within(dialog).findByText('Sent. An admin will read it, and we\'ll email you when they have. Nothing changes on the board.')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Report to admins' })).toHaveFocus();
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Report to admins' })).toBeNull());
  });

  test('at the limit the dialog says so as it opens, in place of the form, with the account\'s own count and focus on its heading', async () => {
    const w = world();
    for (let i = 0; i < 3; i++) w.fake.seed.conductReport({ version: w.mine, section: 'hate', reporter: w.me });
    const send = vi.spyOn(w.fake, 'reportPost');
    const dialog = await dialogFrom(w);
    expect(await within(dialog).findByText('You have 3 reports waiting for an admin. You can send another once one of them is read.')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Report to admins' })).toHaveFocus();
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(foot(dialog)).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  test('under the limit the form shows, and a limit that arrives at send time still replaces it (the server refuses)', async () => {
    const w = world();
    vi.spyOn(w.fake, 'myOpenReports').mockResolvedValueOnce({ open: 0, most: 3 });
    for (let i = 0; i < 3; i++) w.fake.seed.conductReport({ version: w.mine, section: 'hate', reporter: w.me });
    const dialog = await dialogFrom(w);
    await userEvent.click(within(dialog).getByRole('radio', { name: /No hate/u }));
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    expect(await within(dialog).findByText('You have 3 reports waiting for an admin. You can send another once one of them is read.')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Report to admins' })).toHaveFocus();
  });

  test('a count that cannot be read shows the form: the server still refuses', async () => {
    const w = world();
    vi.spyOn(w.fake, 'myOpenReports').mockRejectedValue(new Error('offline'));
    const dialog = await dialogFrom(w);
    expect(await within(dialog).findAllByRole('radio')).toHaveLength(2);
  });

  test('an error is said plainly above the form, which keeps what was typed, and a retry sends it', async () => {
    const w = world();
    const real = w.fake.reportPost.bind(w.fake);
    const send = vi.spyOn(w.fake, 'reportPost').mockRejectedValueOnce(new Error('offline'));
    const dialog = await dialogFrom(w);
    await userEvent.click(within(dialog).getByRole('radio', { name: /No hate/u }));
    await userEvent.type(within(dialog).getByRole('textbox'), 'keep this');
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    const said = await within(dialog).findByRole('alert');
    expect(said).toHaveTextContent('That did not send. Check your connection and press Send to admins again; what you typed is still here.');
    expect(within(dialog).getByRole('heading', { name: 'Report to admins' })).toHaveFocus();
    expect(within(dialog).getByRole('textbox')).toHaveValue('keep this');
    expect(within(dialog).getByRole('radio', { name: /No hate/u })).toBeChecked();
    send.mockImplementation(real);
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    expect(await within(dialog).findByText(/^Sent\./u)).toBeInTheDocument();
  });

  test('a refusal in the server\'s words is an error too, not a state of its own', async () => {
    const w = world();
    vi.spyOn(w.fake, 'reportPost').mockResolvedValueOnce({ ok: false, error: 'a note is at most 1000 characters' });
    const dialog = await dialogFrom(w);
    await userEvent.click(within(dialog).getByRole('radio', { name: /No hate/u }));
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That did not send: a note is at most 1000 characters. What you typed is still here.');
  });

  test('Cancel closes it and gives focus back to the link that opened it', async () => {
    const w = world();
    const dialog = await dialogFrom(w);
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Report to admins' })).toBeNull());
    expect(entry(await screen.findByRole('dialog', { name: 'Report this post' }))).toHaveFocus();
  });

  test('has no axe violations in any state', async () => {
    const w = world();
    const dialog = await dialogFrom(w);
    expect(describeViolations(await axeViolations(dialog))).toBe('');
    await userEvent.click(within(dialog).getByRole('radio', { name: /No hate/u }));
    await userEvent.click(within(foot(dialog)).getByRole('button', { name: 'Send to admins' }));
    await within(dialog).findByText(/^Sent\./u);
    expect(describeViolations(await axeViolations(dialog))).toBe('');
  });
});

/**
 * The brief bars a card, a mark, neon, gold or pink from the entry: the stylesheet's rules for the entry name none of the tokens the marks and the
 * game's colors are drawn with (engine/ui/glass/tokens.css), so a theme cannot turn the plain link into one.
 */
describe('the report entry carries none of the marks\' tokens', () => {
  const css = readFileSync('engine/ui/conduct/report.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const MARKS = /--kb-(?:glass-(?:neon|neon-text|sweet|violet|ready|ready-text|salty|salty-text|over|hurt|estimate|loss)|lens-ink|tag|mark[\w-]*)\b/u;
  const rulesFor = (needle: RegExp) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => needle.test(m[1]!)).map((m) => m[2]!);

  test.each(['.kb-report-foot', '.kb-report-link', '.kb-report-row-link', '.kb-linklike', '.kb-hidden-note', '.kb-hidden-own'])('%s names no mark, game or accent token', (selector) => {
    const found = rulesFor(new RegExp(selector.replace('.', '\\.') + '(?![\\w-])', 'u'));
    expect(found.length).toBeGreaterThan(0);
    for (const body of found) expect(body).not.toMatch(MARKS);
  });
});
