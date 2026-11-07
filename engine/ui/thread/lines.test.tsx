/**
 * The board's line for an announcement (the season-end design, section 4): one Act of the character's own that says everything its
 * player chose to make public, in the engine's words and the instance's class names.
 */
import { screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, test } from 'vitest';
import { useKayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { AnnounceLine, when } from './lines.tsx';

const lines: readonly { readonly what: 'debut' | 'turn'; readonly was?: string; readonly class?: string; readonly says: string }[] = [
  { what: 'debut', says: 'Spritey debuts.' },
  { what: 'debut', class: 'heel', says: 'Spritey debuts as a Heel.' },
  { what: 'turn', says: 'Spritey has Turned.' },
  { what: 'turn', was: 'heel', says: 'Spritey has Turned, leaving Heel.' },
  { what: 'turn', class: 'face', says: 'Spritey has Turned to Face.' },
  { what: 'turn', was: 'heel', class: 'face', says: 'Spritey has Turned from Heel to Face.' },
];

function Line({ act, name }: { readonly act: string; readonly name: string }) {
  const { api } = useKayfa();
  const [read, setRead] = useState<Act | null>(null);
  useEffect(() => { void api.actsById([act]).then((a) => setRead(a[0] ?? null)); }, [api, act]);
  return read ? <AnnounceLine act={read} name={name} /> : null;
}

describe('the announce line', () => {
  test.each(lines)('says "$says"', async ({ what, was, class: cls, says }) => {
    const fake = buildWorld();
    const owner = fake.seed.account('o');
    const spritey = fake.seed.character(owner, 'Spritey', 'face');
    const act = fake.seed.announce(spritey, what, { was, class: cls });
    renderIn(fake, <Line act={act} name="Spritey" />, { path: '/' });
    await waitFor(() => expect(screen.getByText(says)).toBeInTheDocument());
    expect(screen.getByText(says).tagName).toBe('P');
  });

  test('says "an" before a class whose name starts with a vowel', async () => {
    const fake = buildWorld();
    const owner = fake.seed.account('o');
    const spritey = fake.seed.character(owner, 'Spritey', 'face');
    const act = fake.seed.announce(spritey, 'debut', { class: 'alpha' });
    const instance = { ...testInstance, classes: [...testInstance.classes, { key: 'alpha', name: 'Alpha', earn: () => [] }] };
    renderIn(fake, <Line act={act} name="Spritey" />, { path: '/', instance });
    await waitFor(() => expect(screen.getByText('Spritey debuts as an Alpha.')).toBeInTheDocument());
  });

  test('names a class key the instance does not know as the key itself, as it is everywhere', async () => {
    const fake = buildWorld();
    const owner = fake.seed.account('o');
    const spritey = fake.seed.character(owner, 'Spritey', 'face');
    const act = fake.seed.announce(spritey, 'turn', { was: 'heel', class: 'ghost' });
    renderIn(fake, <Line act={act} name="Spritey" />, { path: '/' });
    await waitFor(() => expect(screen.getByText('Spritey has Turned from Heel to ghost.')).toBeInTheDocument());
  });
});

describe('the post line\'s date', () => {
  const at = '2026-10-29T21:14:00Z';
  const now = Date.parse('2026-11-07T12:00:00Z');
  test('keeps its year at 1440', () => expect(when(at)).toMatch(/^Oct 29, 2026, \d+:14 [AP]M$/u));
  test('a phone drops this year\'s, against the clock it is given', () => expect(when(at, true, now)).toMatch(/^Oct 29, \d+:14 [AP]M$/u));
  test('a phone keeps the year across a year boundary', () => expect(when('2025-12-31T21:14:00Z', true, Date.parse('2026-01-02T12:00:00Z'))).toMatch(/^Dec 31, 2025, \d+:14 [AP]M$/u));
  /* vitest runs in America/Los_Angeles (vitest.config.ts): 03:00 UTC on Jan 1 is Dec 31, 7:00 PM there, so the local year is the earlier one. */
  test('a phone compares local years, not UTC\'s: a date the evening before New Year\'s UTC keeps its year', () => expect(when('2026-01-01T03:00:00Z', true, Date.parse('2026-02-10T12:00:00Z'))).toBe('Dec 31, 2025, 7:00 PM'));
  test('and drops the year when the clock is already UTC\'s next year but local is still this one', () => expect(when('2026-06-01T12:00:00Z', true, Date.parse('2027-01-01T03:00:00Z'))).toBe('Jun 1, 5:00 AM'));
  test('a phone keeps another year\'s', () => expect(when('2025-10-29T21:14:00Z', true, now)).toMatch(/^Oct 29, 2025, \d+:14 [AP]M$/u));
});
