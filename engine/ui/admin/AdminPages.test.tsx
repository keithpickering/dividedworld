import { act, cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { shortTime } from '../postbit/dates.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { AdminPages } from './AdminPages.tsx';

afterEach(cleanup);

const MINUTE = 60_000;
const isoAgo = (fake: Fake, minutes: number) => new Date(fake.clock.now() - minutes * MINUTE).toISOString();

function world(stopped: Record<string, number> = {}): Fake {
  const fake = buildWorld();
  for (const [job, minutes] of Object.entries(stopped)) fake.seed.job(job, { lastOkAt: isoAgo(fake, minutes) });
  fake.signInAs(fake.seed.account('strip-admin', { admin: true }));
  return fake;
}
const open = (fake: Fake) => renderIn(fake, <AdminPages current="moves" />, { path: '/admin/queue' });

describe('the admin pages strip', () => {
  test('has Jobs after Trophies', async () => {
    open(world());
    const nav = await screen.findByRole('navigation', { name: 'Admin pages' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Moves', 'Reports', 'The machine', 'Trophies', 'Jobs']);
  });

  test('shows no line while every job is running', async () => {
    open(world());
    await screen.findByRole('navigation', { name: 'Admin pages' });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('says one job has stopped, since when, and links to Jobs', async () => {
    const fake = world({ 'kayfabb-conceal': 30 });
    open(fake);
    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent(`1 job has stopped: conceal, since ${shortTime(isoAgo(fake, 30), fake.clock.now())}.`);
    expect(within(line).getByRole('link', { name: /1 job has stopped/u })).toHaveAttribute('href', '/admin/jobs');
  });

  test('names two stopped jobs in the jobs\' order, with the earliest since', async () => {
    const fake = world({ 'kayfabb-write': 50, 'kayfabb-mail': 30 });
    open(fake);
    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent(`2 jobs have stopped: mail, write, since ${shortTime(isoAgo(fake, 50), fake.clock.now())}.`);
  });
});
