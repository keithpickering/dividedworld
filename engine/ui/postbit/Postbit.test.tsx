import { screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Character } from '../data/api.ts';
import { renderInWorld } from '../test-world.tsx';
import { monthYear, shortDate } from './dates.ts';
import { Postbit, Signature, type PostbitPerson } from './Postbit.tsx';
import { reveals } from './reveals.ts';

const character = (over: Partial<Character> = {}): Character => ({
  id: 'c1', name: 'Pipewrench', title: 'Professional Wrench', signature: '', avatarSquare: 'sq.webp', avatarPortrait: 'tall.webp',
  squareFrame: null, portraitFrame: null, pipStyle: 'default', joined: '2026-10-01', ...over,
});
const person = (over: Partial<PostbitPerson> = {}, c: Partial<Character> = {}): PostbitPerson => ({
  character: character(c), posts: 212, standing: 650, revealed: null, turnedAt: null, ...over,
});
const show = (p: PostbitPerson, layout: 'side' | 'stacked' = 'side') => renderInWorld(<Postbit person={p} layout={layout} />);
const slot = () => document.querySelector('.kb-postbit-avatar')!;

describe('the postbit', () => {
  test('name, title, posts and the month joined, never the day', () => {
    show(person());
    const bit = screen.getByRole('group', { name: 'About Pipewrench' });
    expect(within(bit).getByText('Pipewrench')).toBeInTheDocument();
    expect(within(bit).getByText('Professional Wrench')).toBeInTheDocument();
    expect(bit).toHaveTextContent('Posts: 212');
    expect(bit).toHaveTextContent('Joined Oct 2026');
    expect(bit).not.toHaveTextContent('Oct 1,');
  });

  test('side by side puts the portrait in the tall slot, with the square for a phone', () => {
    show(person());
    expect(screen.getByRole('group')).toHaveAttribute('data-kb-postbit', 'side');
    expect(slot().querySelector('img')).toHaveAttribute('src', 'tall.webp');
    expect(slot().querySelector('source')).toHaveAttribute('srcset', 'sq.webp');
  });

  test('the square fills the tall slot where there is no portrait', () => {
    show(person({}, { avatarPortrait: null }));
    expect(slot().querySelector('img')).toHaveAttribute('src', 'sq.webp');
    expect(slot()).toHaveAttribute('data-kb-slot', 'tall');
  });

  test('stacked uses the square, and never loads the portrait', () => {
    show(person(), 'stacked');
    expect(screen.getByRole('group')).toHaveAttribute('data-kb-postbit', 'stacked');
    expect(slot().querySelector('img')).toHaveAttribute('src', 'sq.webp');
    expect(slot().querySelector('source')).toBeNull();
  });

  test('no avatar at all shows the initial, which is decoration', () => {
    show(person({}, { avatarSquare: null, avatarPortrait: null }));
    expect(slot().querySelector('img')).toBeNull();
    expect(slot()).toHaveTextContent('P');
    expect(slot()).toHaveAttribute('aria-hidden', 'true');
    /* The tall slot is for a portrait, or a square standing in for one: never an empty tall box. */
    expect(slot()).toHaveAttribute('data-kb-slot', 'square');
  });

  test('the rank is the highest whose threshold the standing reaches, with that many pips filled', () => {
    show(person({ standing: 650 }));
    expect(screen.getByText('Main Eventer')).toBeInTheDocument();
    const pips = screen.getByRole('img', { name: 'Rank 3 of 3: Main Eventer' });
    expect(pips.querySelectorAll('.kb-pip')).toHaveLength(3);
    expect(pips.querySelectorAll('.kb-pip[data-kb-filled]')).toHaveLength(3);
  });

  test('a standing short of every threshold but the first is the first rank; none yet is the same', () => {
    const { unmount } = show(person({ standing: 299 }));
    expect(screen.getByRole('img', { name: 'Rank 1 of 3: Jobber' }).querySelectorAll('.kb-pip[data-kb-filled]')).toHaveLength(1);
    unmount();
    show(person({ standing: null }));
    expect(screen.getByRole('img', { name: 'Rank 1 of 3: Jobber' })).toBeInTheDocument();
  });

  test('the pips are drawn from the character\'s pip style, the default where the style is unknown', () => {
    show(person({}, { pipStyle: 'gone' }));
    const row = screen.getByRole('img', { name: /^Rank/ });
    expect(row.getAttribute('style')).toContain('full.svg');
    expect(row.getAttribute('style')).toContain('empty.svg');
  });

  test('nothing about a class unless its player made it public', () => {
    show(person());
    expect(screen.getByRole('group')).not.toHaveTextContent(/Revealed|Turned/);
  });

  test('a revealed class, dated', () => {
    show(person({ revealed: { class: 'heel', at: '2026-10-03T15:00:00Z' } }));
    expect(screen.getByRole('group')).toHaveTextContent('Revealed: Heel (Oct 3)');
  });

  test('and "Has Turned since" when a later announced Turn came after it', () => {
    show(person({ revealed: { class: 'heel', at: '2026-10-03T15:00:00Z' }, turnedAt: '2026-10-20T15:00:00Z' }));
    const bit = screen.getByRole('group');
    expect(bit).toHaveTextContent('Revealed: Heel (Oct 3)');
    expect(bit).toHaveTextContent('Has Turned since (Oct 20)');
  });

  test('the signature is BBCode', () => {
    renderInWorld(<Signature text="i fix things. [b]sometimes[/b] they were working." />);
    expect(document.querySelector('.kb-signature strong')).toHaveTextContent('sometimes');
  });
});

describe('reveals(): which statement of its class a character has made', () => {
  const rev = (character: string, cls: string, at: string) => ({ act: `${character}${at}`, character, class: cls, at, via: 'act' as const, thread: 't' });
  const turn = (character: string, at: string) => ({ act: `${character}${at}`, character, at, was: null, since: null });
  test('the latest reveal, and only a Turn after it', () => {
    const out = reveals(
      [rev('a', 'face', '2026-09-01T00:00:00Z'), rev('a', 'heel', '2026-10-03T00:00:00Z'), rev('b', 'face', '2026-10-05T00:00:00Z')],
      [turn('a', '2026-09-15T00:00:00Z'), turn('a', '2026-10-20T00:00:00Z'), turn('c', '2026-10-21T00:00:00Z')],
    );
    expect(out.get('a')).toEqual({ revealed: { class: 'heel', at: '2026-10-03T00:00:00Z' }, turnedAt: '2026-10-20T00:00:00Z' });
    expect(out.get('b')).toEqual({ revealed: { class: 'face', at: '2026-10-05T00:00:00Z' }, turnedAt: null });
    expect(out.has('c')).toBe(false);
  });
});

describe('dates', () => {
  test('the tests run in a zone that is not UTC, so a local date and a UTC date can differ', () => {
    expect(process.env.TZ).toBe('America/Los_Angeles');
    expect(new Date('2026-10-04T03:00:00Z').getDate()).toBe(3);
  });

  test('a reveal or Turn date is the reader\'s local date, like every time in a thread', () => {
    expect(shortDate('2026-10-04T03:00:00Z')).toBe('Oct 3');
    show(person({ revealed: { class: 'heel', at: '2026-10-04T03:00:00Z' }, turnedAt: '2026-11-01T02:00:00Z' }));
    expect(screen.getByRole('group')).toHaveTextContent('Revealed: Heel (Oct 3)');
    expect(screen.getByRole('group')).toHaveTextContent('Has Turned since (Oct 31)');
  });

  test('"Joined" is the calendar month the server gave, whatever the reader\'s zone', () => {
    expect(monthYear('2026-10-01')).toBe('Oct 2026');
    show(person({}, { joined: '2026-10-01' }));
    expect(screen.getByRole('group')).toHaveTextContent('Joined Oct 2026');
  });

  test('a date that cannot be read is nothing, and the postbit then says nothing about when it joined', () => {
    expect(monthYear('')).toBe('');
    expect(monthYear('not a date')).toBe('');
    show(person({}, { joined: '' }));
    expect(screen.getByRole('group')).not.toHaveTextContent(/Joined|undefined|NaN/u);
    expect(screen.getByRole('group')).toHaveTextContent('Posts: 212');
  });
});
