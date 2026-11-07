import { render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Ago, ago, useSignedIn, Who } from './mini.tsx';
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
