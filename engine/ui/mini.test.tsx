import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Ago, Byline, ago, useSignedIn, Who } from './mini.tsx';
import type { Character } from './data/api.ts';
import { useKayfa } from './context.tsx';
import { widthOf } from './test-width.ts';
import { renderInWorld } from './test-world.tsx';

test('Ago says how long ago against a clock it is given, like ago()', () => {
  const at = '2026-10-29T11:58:00Z';
  const now = Date.parse('2026-10-29T12:00:00Z');
  expect(ago(at, now)).toBe('2 min ago');
  render(<Ago at={at} now={now} />);
  expect(screen.getByText('2 min ago')).toBeInTheDocument();
});

test('ago on a phone drops the year only within the reader\'s own current year: across a year boundary, and by local year in a zone behind UTC', () => {
  /* vitest runs in America/Los_Angeles (vitest.config.ts), where 03:00 UTC on Jan 1 is still Dec 31 the evening before. */
  expect(ago('2025-12-20T12:00:00Z', Date.parse('2026-01-05T12:00:00Z'), true)).toBe('Dec 20, 2025');
  expect(ago('2026-01-05T12:00:00Z', Date.parse('2026-02-10T12:00:00Z'), true)).toBe('Jan 5');
  expect(ago('2026-01-01T03:00:00Z', Date.parse('2026-02-10T12:00:00Z'), true)).toBe('Dec 31, 2025');
  expect(ago('2026-06-01T12:00:00Z', Date.parse('2027-01-01T03:00:00Z'), true)).toBe('Jun 1');
});

test('useSignedIn reads the player\'s session and asks the server nothing of its own', async () => {
  let sessions = 0;
  function Probe() {
    const signedIn = useSignedIn(useKayfa().api);
    return <p>{signedIn === null ? 'unknown' : signedIn ? 'signed in' : 'signed out'}</p>;
  }
  renderInWorld(<Probe />, {
    seed: (fake) => {
      fake.signInAs(fake.seed.account('ann@example.com'));
      const session = fake.session.bind(fake);
      fake.session = () => { sessions += 1; return session(); };
    },
  });
  expect(await screen.findByText('signed in')).toBeInTheDocument();
  expect(sessions).toBe(1);
});

test('useSignedIn answers signed out when the session cannot be read, so the sign-in line shows rather than nothing', async () => {
  function Probe() {
    const signedIn = useSignedIn(useKayfa().api);
    return <p>{signedIn === null ? 'unknown' : signedIn ? 'signed in' : 'signed out'}</p>;
  }
  renderInWorld(<Probe />, { seed: (fake) => { fake.session = () => Promise.reject(new Error('offline')); } });
  expect(await screen.findByText('signed out')).toBeInTheDocument();
});

const ann = { id: 'c1', name: 'Ann', avatarSquare: '/ann.png' } as unknown as Character;

test('Byline draws the avatar and the name as the profile link', () => {
  const { container } = renderInWorld(<Byline character={ann} id="c1" name="Ann" link />);
  expect(container.querySelector('.kb-mini img')).toHaveAttribute('src', '/ann.png');
  expect(screen.getByRole('link', { name: 'Ann' })).toHaveAttribute('href', '/c/c1');
});

test('Byline with no avatar draws the first letter', () => {
  const { container } = renderInWorld(<Byline character={{ ...ann, avatarSquare: null }} id="c1" name="Ann" link />);
  expect(container.querySelector('.kb-mini-none')).toHaveTextContent('A');
  expect(container.querySelector('img')).toBeNull();
});

test('Byline with no id is the staff, not a link', () => {
  const { container } = renderInWorld(<Byline character={undefined} id={null} link />);
  expect(container.querySelector('.kb-system-name')).toHaveTextContent('The staff');
  expect(screen.queryByRole('link')).toBeNull();
  expect(container.querySelector('.kb-mini-none')).toHaveTextContent('S');
});

test('Byline for the staff can leave the avatar out, as the index does', () => {
  const { container } = renderInWorld(<Byline character={undefined} id={null} link avatar={false} />);
  expect(container.querySelector('.kb-mini')).toBeNull();
  expect(container.querySelector('.kb-system-name')).toHaveTextContent('The staff');
});

test('Byline hides the avatar from assistive tech: the name is the only accessible text', () => {
  const { container } = renderInWorld(<Byline character={ann} id="c1" name="Ann" link />);
  expect(container.querySelector('.kb-mini')).toHaveAttribute('aria-hidden', 'true');
  expect(container).toHaveTextContent(/^Ann$/u);
});

test('Byline for a character that has not loaded draws its name\'s first letter', () => {
  const { container } = renderInWorld(<Byline character={undefined} id="c9" name="A character" link />);
  expect(container.querySelector('.kb-mini-none')).toHaveTextContent('A');
});

test('Byline unlinked draws the name as plain text', () => {
  const { container } = renderInWorld(<Byline character={ann} id="c1" name="Ann" link={false} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(container.querySelector('.kb-byline-name')).toHaveTextContent('Ann');
  expect(container.querySelector('a')).toBeNull();
  expect(container.querySelector('.kb-byline-name')!.tagName).toBe('SPAN');
  expect(container.querySelector('.kb-byline-name')).not.toHaveAttribute('role');
});

test('Byline with an id whose character has not loaded still links, as "A character"', () => {
  renderInWorld(<Byline character={undefined} id="c9" link />);
  expect(screen.getByRole('link', { name: 'A character' })).toHaveAttribute('href', '/c/c9');
});

test('Who is one unit: the mini avatar (hidden from assistive tech) and the name\'s own words, in one inline-flex box', () => {
  render(<Who character={undefined} name="Spritey"><a href="/c/s">Spritey</a></Who>);
  const link = screen.getByRole('link', { name: 'Spritey' });
  const unit = link.parentElement!;
  expect(unit).toHaveClass('kb-who');
  expect(unit.firstElementChild).toHaveClass('kb-mini');
  expect(unit.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  expect(unit.firstElementChild).toHaveTextContent('S');
});

afterEach(() => vi.unstubAllGlobals());

/* The year drops only on a phone and only in the current year, against the clock the page reads (`now`, else Date.now()), so no test depends on the calendar date. */
test('a date in the current year drops its year at 390 and keeps it at 1440', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const at = '2026-10-05T12:00:00Z';
  widthOf(390);
  const phone = render(<Ago at={at} now={now} />);
  expect(phone.container.querySelector('time')).toHaveTextContent(/^Oct 5$/u);
  phone.unmount();
  widthOf(1440);
  render(<Ago at={at} now={now} />);
  expect(screen.getByText('Oct 5, 2026')).toBeInTheDocument();
});

test('a date from an earlier year keeps its year on a phone', () => {
  widthOf(390);
  render(<Ago at="2025-10-05T12:00:00Z" now={Date.parse('2026-11-07T12:00:00Z')} />);
  expect(screen.getByText('Oct 5, 2025')).toBeInTheDocument();
});

test('the year is against the clock the page is given, so the calendar date is never the test\'s', () => {
  widthOf(390);
  render(<Ago at="2026-10-05T12:00:00Z" now={Date.parse('2027-01-20T12:00:00Z')} />);
  expect(screen.getByText('Oct 5, 2026')).toBeInTheDocument();
});

test('a relative time is the same on a phone', () => {
  widthOf(390);
  render(<Ago at="2026-10-29T11:58:00Z" now={Date.parse('2026-10-29T12:00:00Z')} />);
  expect(screen.getByText('2 min ago')).toBeInTheDocument();
});
