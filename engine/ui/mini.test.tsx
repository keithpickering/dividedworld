import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Ago, Byline, ago, useSignedIn } from './mini.tsx';
import type { Character } from './data/api.ts';
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

test('Byline with no id is The System, not a link', () => {
  const { container } = renderInWorld(<Byline character={undefined} id={null} link />);
  expect(container.querySelector('.kb-system-name')).toHaveTextContent('The System');
  expect(screen.queryByRole('link')).toBeNull();
});

test('Byline unlinked draws the name as plain text', () => {
  const { container } = renderInWorld(<Byline character={ann} id="c1" name="Ann" link={false} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(container.querySelector('.kb-byline-name')).toHaveTextContent('Ann');
});

test('Byline with an id whose character has not loaded still links, as "A character"', () => {
  renderInWorld(<Byline character={undefined} id="c9" link />);
  expect(screen.getByRole('link', { name: 'A character' })).toHaveAttribute('href', '/c/c9');
});
