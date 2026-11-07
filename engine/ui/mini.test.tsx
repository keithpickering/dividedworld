import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Ago, ago, useSignedIn, Who } from './mini.tsx';
import { useKayfa } from './context.tsx';
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
