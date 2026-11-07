import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { testInstance, buildWorld, renderIn } from '../test-world.tsx';
import { dayAndTime } from '../characters/format.ts';
import { MoveNotice } from './MoveNotice.tsx';
import { seedMoves, type MoveWorld } from './move-world.ts';

beforeEach(() => localStorage.clear());

function open(options: { readonly build?: (fake: Fake, w: MoveWorld) => void } = {}) {
  const fake = buildWorld();
  const w = seedMoves(fake, testInstance);
  options.build?.(fake, w);
  renderIn(fake, <MoveNotice act={w.inForce} />, { path: `/b/${w.general}` });
  return { fake, w };
}

const segment = () => screen.findByRole('button', { name: /^WAY OUT:/u });

describe('the Boss\'s notice on the board its move changed', () => {
  test('is drawn as a 2003 announcement from the Boss, in its own words, with a link to its profile', async () => {
    const { w } = open();
    const notice = await screen.findByRole('table', { name: 'Announcement from The Director' });
    expect(notice).toHaveTextContent('Announcement from The Director');
    expect(notice).not.toHaveTextContent('ANNOUNCEMENT');
    expect(notice).toHaveTextContent('This board has been IMPROVED. From now on we talk about toast.');
    expect(within(notice).getByRole('link', { name: 'The Director' })).toHaveAttribute('href', `/c/${w.director}`);
  });

  test('is a table: a light band, the Boss\'s words under it, and the glass label and Way out on the band\'s corner, outside the table', async () => {
    open();
    const notice = await screen.findByRole('table', { name: 'Announcement from The Director' });
    const rows = within(notice).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('td.kb-bar')).not.toBeNull();
    expect(rows[1]).toHaveTextContent('This board has been IMPROVED.');
    expect(within(rows[1]!).getByRole('list', { name: 'Reactions' })).toBeInTheDocument();
    const frame = document.querySelector('.kb-move-notice')!;
    expect(frame.contains(notice)).toBe(true);
    const tag = frame.querySelector('.kb-move-tag')!;
    expect(tag).not.toBeNull();
    expect(notice.contains(tag)).toBe(false);
    expect(within(tag as HTMLElement).getByRole('button', { name: /^WAY OUT:/u })).toBeInTheDocument();
  });

  test('shows its top three reactions, small, and leaves the fourth out', async () => {
    open();
    const notice = await screen.findByRole('table', { name: 'Announcement from The Director' });
    const chips = within(notice).getByRole('list', { name: 'Reactions' });
    const items = within(chips).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['Fire, 9F 9', 'Tomato, 6T 6', 'Tea, 3E 3']);
    expect(within(chips).queryByText(/Zzz/u)).toBeNull();
  });

  test('carries the Act\'s long label in glass, from the move kind\'s catalog and never from the Boss\'s words', async () => {
    const fake = buildWorld();
    const w = seedMoves(fake, testInstance);
    const sly = fake.seed.move('director', { board: w.second, name: 'Cheese Cellar', body: 'Nothing was renamed here. THE ADMIN DID IT.', at: fake.clock.now() - 1000 });
    renderIn(fake, <MoveNotice act={sly} />, { path: '/' });
    const notice = await screen.findByRole('table', { name: 'Announcement from The Director' });
    expect(screen.getByText('The Boss renamed this board')).toBeInTheDocument();
    expect(notice).toHaveTextContent('Nothing was renamed here. THE ADMIN DID IT.');
  });

  test('the way out is a plain segment with the count and what is counted', async () => {
    open();
    const way = await segment();
    expect(way).toHaveTextContent('WAY OUT: 5 OF 12 POSTERS');
    expect(way).toHaveAttribute('aria-haspopup', 'dialog');
    expect(way).toHaveAttribute('aria-expanded', 'false');
  });

  test('a move that asks nothing says it runs out, with its date', async () => {
    const fake = buildWorld();
    const w = seedMoves(fake, testInstance);
    const plain = fake.seed.move('director', { board: w.general, name: 'Quiet Hall', at: fake.clock.now() - 1000, expiresAt: Date.UTC(2026, 10, 13, 12) });
    renderIn(fake, <MoveNotice act={plain} />, { path: '/' });
    expect(await segment()).toHaveTextContent('WAY OUT: RUNS OUT NOV 13');
  });

  test('is nothing at all for an Act that is no move, and is plain about a read that failed', async () => {
    const fake = buildWorld();
    const w = seedMoves(fake, testInstance);
    const { container } = renderIn(fake, <MoveNotice act={w.me} />, { path: '/' });
    await waitFor(() => expect(container.querySelector('.kb-move-notice')).toBeNull());
    expect(screen.queryByRole('button', { name: /WAY OUT/u })).toBeNull();
  });
});

describe('the way-out segment\'s focus ring', () => {
  test('uses the board\'s focus token, since it is drawn outside the dark tag on the board page (a glass-white ring there is about 1.2:1)', () => {
    const css = readFileSync('engine/ui/board/move.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const rule = /\.kb-move-way:focus-visible\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/outline:\s*\d+px solid var\(--kb-focus\)/u);
    expect(rule).not.toMatch(/glass/u);
  });
});

describe('the overlay that opens from the way out', () => {
  test('a move with no demand says it asks nothing and then that it ends on its date, never "if that does not happen"', async () => {
    const fake = buildWorld();
    const w = seedMoves(fake, testInstance);
    const plain = fake.seed.move('director', { board: w.general, name: 'Quiet Hall', at: fake.clock.now() - 1000, expiresAt: Date.UTC(2026, 10, 13, 12) });
    renderIn(fake, <MoveNotice act={plain} />, { path: '/' });
    await userEvent.click(await segment());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('It asks nothing of the board.');
    expect(dialog).toHaveTextContent(/It ends on Nov 13\./u);
    expect(dialog).not.toHaveTextContent('If that does not happen');
  });

  test('opens from the keyboard with Enter or Space, and names what was done, the demand in words, its progress, the expiry and the admin\'s power', async () => {
    const { w } = open();
    const way = await segment();
    way.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'The Boss renamed this board' });
    expect(way).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveTextContent('The Boss renamed a board to "Pointless Toast Palace"');
    expect(dialog).toHaveTextContent(`It was called ${w.generalName}.`);
    expect(dialog).toHaveTextContent('Needs 12 different characters to post on this board: 5 of 12 so far.');
    const bar = within(dialog).getByRole('progressbar', { name: 'Progress toward the way out' });
    expect(bar).toHaveAttribute('aria-valuenow', '5');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '12');
    expect(bar).toHaveAttribute('aria-valuetext', '5 of 12 posters');
    expect(dialog).toHaveTextContent(/If that does not happen, it ends on [A-Z][a-z]{2} \d{1,2}/u);
    expect(dialog).toHaveTextContent('An admin can reverse it at any time.');
    expect(dialog).toHaveTextContent('The announcement on the board is in character and may bluff.');
  });

  test('says when the tick counted the demand, in the reader\'s own time', async () => {
    const { fake } = open();
    await userEvent.click(await segment());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(`Counted ${dayAndTime(new Date(fake.clock.now()).toISOString())}.`);
    expect(dialog).toHaveTextContent('5 of 12 so far.');
  });

  test('a demand the tick has not counted yet says so, plainly, and shows no number and no bar', async () => {
    const fake = buildWorld();
    const w = seedMoves(fake, testInstance);
    const fresh = fake.seed.move('director', {
      board: w.general, name: 'Fresh Hall', at: fake.clock.now() - 1000, uncounted: true,
      demand: { kind: 'distinctCharactersOnBoard', params: { board: w.general, count: 12 } }, expiresAt: Date.UTC(2026, 10, 13, 12),
    });
    renderIn(fake, <MoveNotice act={fresh} />, { path: '/' });
    const way = await segment();
    expect(way).toHaveTextContent('WAY OUT: DETAILS');
    expect(way.textContent).not.toMatch(/\d+ OF \d+/u);
    await userEvent.click(way);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('It has not been counted yet.');
    expect(dialog).not.toHaveTextContent(/\d+ of \d+/u);
    expect(dialog).not.toHaveTextContent('Counted');
    expect(within(dialog).queryByRole('progressbar')).toBeNull();
  });

  test('opens with Space as well', async () => {
    open();
    (await segment()).focus();
    await userEvent.keyboard(' ');
    expect(await screen.findByRole('dialog', { name: 'The Boss renamed this board' })).toBeInTheDocument();
  });

  test('holds focus while it is open and gives it back to the segment when Escape closes it', async () => {
    open();
    const way = await segment();
    way.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'The Boss renamed this board' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.tab({ shift: true });
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(way).toHaveFocus());
    expect(way).toHaveAttribute('aria-expanded', 'false');
  });

  test('Close does the same as Escape', async () => {
    open();
    const way = await segment();
    await userEvent.click(way);
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(way).toHaveFocus());
  });
});
