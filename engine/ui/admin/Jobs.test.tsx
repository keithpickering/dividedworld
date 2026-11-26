import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { JOBS } from '../../rules/jobs.ts';
import type { Fake } from '../data/fake.ts';
import { shortTime } from '../postbit/dates.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { JobsScreen } from './Jobs.tsx';

afterEach(cleanup);

const MINUTE = 60_000;
const isoAgo = (fake: Fake, minutes: number) => new Date(fake.clock.now() - minutes * MINUTE).toISOString();

/** Every job scheduled every minute and last good a minute ago, with a pg_cron run to match, as a healthy instance is. */
function healthy(as: 'admin' | 'player' = 'admin'): Fake {
  const fake = buildWorld();
  for (const j of JOBS) {
    fake.seed.job(j.name, { lastOkAt: isoAgo(fake, 1) });
    fake.seed.jobRun(j.name, { status: 'succeeded', message: j.fn === null ? null : '1 row', at: fake.clock.now() - MINUTE });
  }
  const admin = fake.seed.account('jobs-admin', { admin: true });
  const player = fake.seed.account('jobs-player');
  fake.signInAs(as === 'admin' ? admin : player);
  return fake;
}
const open = (fake: Fake) => renderIn(fake, <JobsScreen />, { path: '/admin/jobs' });
const rowOf = async (name: string) => (await screen.findByRole('rowheader', { name: new RegExp(`^${name}\\b`, 'u') })).closest('tr')!;
const timeAgo = (fake: Fake, minutes: number) => shortTime(isoAgo(fake, minutes), fake.clock.now());

/** conceal stopped: last good 30 minutes ago, grace 10. */
function stopConceal(fake: Fake, run: { status: string; message: string | null } | null) {
  fake.seed.job('kayfabb-conceal', { lastOkAt: isoAgo(fake, 30) });
  fake.seed.jobRun('kayfabb-conceal', run === null ? null : { ...run, at: fake.clock.now() - MINUTE });
}

describe('the jobs page', () => {
  test('with every job running, the lead says so, no row is stopped, and the strip has Jobs as the current page', async () => {
    open(healthy());
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
    expect(await screen.findByText('All 10 jobs are running.')).toBeInTheDocument();
    expect(screen.queryByText(/Stopped/u)).toBeNull();
    const strip = screen.getByRole('navigation', { name: 'Admin pages' });
    expect(within(strip).getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    expect(within(strip).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/admin/jobs');
    expect(screen.getByText(/only reads/u)).toBeInTheDocument();
  });

  test('a running row has its name, what it does, its schedule in words and its last good run', async () => {
    const fake = healthy();
    fake.seed.job('kayfabb-settle', { schedule: '17 8 * * *', lastOkAt: isoAgo(fake, 1) });
    fake.seed.job('kayfabb-mail', { schedule: '*/5 * * * *', lastOkAt: isoAgo(fake, 1) });
    fake.seed.job('kayfabb-meet', { schedule: '41 * * * *', lastOkAt: isoAgo(fake, 1) });
    fake.seed.job('kayfabb-staff', { schedule: '0 9 1 * *', lastOkAt: isoAgo(fake, 1) });
    open(fake);
    const settle = await rowOf('settle');
    expect(settle).toHaveTextContent('Settles Aura');
    expect(settle).toHaveTextContent('daily at 08:17');
    expect(settle).toHaveTextContent(`Running · ${timeAgo(fake, 1)}`);
    expect(await rowOf('mail')).toHaveTextContent('every 5 minutes');
    expect(await rowOf('meet')).toHaveTextContent('hourly at :41');
    expect(await rowOf('staff')).toHaveTextContent('0 9 1 * *');
    expect(await rowOf('chatter')).toHaveTextContent('every 15 minutes');
    expect(await rowOf('conceal')).toHaveTextContent('every minute');
  });

  test('stopped jobs come first, then the rest by name', async () => {
    const fake = healthy();
    stopConceal(fake, { status: 'succeeded', message: '1 row' });
    fake.seed.job('kayfabb-write', { lastOkAt: isoAgo(fake, 40) });
    open(fake);
    await screen.findByText('2 jobs have stopped.');
    const names = within(screen.getByRole('table')).getAllByRole('rowheader').map((h) => h.firstChild!.textContent);
    expect(names).toEqual(['conceal', 'write', 'chatter', 'mail', 'meet', 'search-rebuild', 'settle', 'staff', 'system-tick', 'view-counts']);
  });

  test('a stopped job with a request sent says the function never answers well', async () => {
    const fake = healthy();
    stopConceal(fake, { status: 'succeeded', message: '1 row' });
    open(fake);
    expect(await screen.findByText('1 job has stopped.')).toBeInTheDocument();
    const row = await rowOf('conceal');
    expect(row).toHaveTextContent(`Stopped since ${timeAgo(fake, 30)} (missed 20 runs)`);
    const note = row.nextElementSibling as HTMLElement;
    expect(note).toHaveTextContent(`pg_cron ${timeAgo(fake, 1)}: succeeded, a request was sent`);
    expect(note).toHaveTextContent('kayfabb_functions_url present');
    expect(note).toHaveTextContent('kayfabb_jobs_key present');
    expect(note).toHaveTextContent('scheduled, active');
    expect(note).toHaveTextContent("The request is sent and the function never answers well. Look at conceal's log in Supabase.");
  });

  test('a SQL job that stopped says the command runs and fails or never finishes', async () => {
    const fake = healthy();
    fake.seed.job('kayfabb-system-tick', { lastOkAt: isoAgo(fake, 30) });
    open(fake);
    const note = (await rowOf('system-tick')).nextElementSibling as HTMLElement;
    expect(note).not.toHaveTextContent('Vault');
    expect(note).toHaveTextContent('The command runs and fails or never finishes: the message above is why.');
  });

  test('a job not in cron.job says to run the migrations', async () => {
    const fake = healthy();
    fake.seed.job('kayfabb-conceal', { schedule: null, lastOkAt: isoAgo(fake, 30) });
    open(fake);
    const note = (await rowOf('conceal')).nextElementSibling as HTMLElement;
    expect(note).toHaveTextContent('not scheduled');
    expect(note).toHaveTextContent('The job is not in cron.job: run the migrations (README, the release steps).');
  });

  test('a missing Vault entry is named, and the next step is to add it', async () => {
    const fake = healthy();
    stopConceal(fake, { status: 'succeeded', message: '0 rows' });
    fake.seed.jobVault({ jobsKey: false });
    open(fake);
    const note = (await rowOf('conceal')).nextElementSibling as HTMLElement;
    expect(note).toHaveTextContent('kayfabb_functions_url present');
    expect(note).toHaveTextContent('kayfabb_jobs_key missing');
    expect(note).toHaveTextContent('Add the missing Vault entry (README, Give the jobs their address and key).');
  });

  test('a function job whose run had no row says no request was sent', async () => {
    const fake = healthy();
    stopConceal(fake, { status: 'succeeded', message: '0 rows' });
    open(fake);
    const note = (await rowOf('conceal')).nextElementSibling as HTMLElement;
    expect(note).toHaveTextContent('succeeded, no request was sent');
    expect(note).toHaveTextContent("The job's command sent nothing: check both Vault entries have values.");
  });

  test('a run pg_cron has not finished is named as it stands, with nothing said about a request', async () => {
    const fake = healthy();
    stopConceal(fake, { status: 'running', message: null });
    open(fake);
    const note = (await rowOf('conceal')).nextElementSibling as HTMLElement;
    expect(note).toHaveTextContent(`pg_cron ${shortTime(new Date(fake.clock.now() - MINUTE).toISOString(), fake.clock.now())}: running ·`);
    expect(note).not.toHaveTextContent('request was sent');
    expect(note).toHaveTextContent("pg_cron's last run of it has not finished: check pg_cron in Supabase.");
  });

  test('a run pg_cron failed shows its message and says the message is why', async () => {
    const fake = healthy();
    stopConceal(fake, { status: 'failed', message: 'permission denied for table job_runs' });
    open(fake);
    const note = (await rowOf('conceal')).nextElementSibling as HTMLElement;
    expect(note).toHaveTextContent('failed: permission denied for table job_runs');
    expect(note).toHaveTextContent('pg_cron could not run it: the message above is why.');
  });

  test('a job that has never run says so, and a schedule the engine cannot read is shown as it is', async () => {
    const fake = healthy();
    fake.seed.job('kayfabb-chatter', { lastOkAt: null, firstSeen: null });
    fake.seed.job('kayfabb-mail', { schedule: '30 seconds', lastOkAt: isoAgo(fake, 30) });
    open(fake);
    expect(await rowOf('chatter')).toHaveTextContent('Stopped: has not run yet');
    const mail = await rowOf('mail');
    expect(mail.nextElementSibling).toHaveTextContent('its schedule is not one the engine reads: 30 seconds');
  });

  test('past 99 missed runs the floor is worded as 99 or more', async () => {
    const fake = healthy();
    fake.seed.job('kayfabb-conceal', { lastOkAt: isoAgo(fake, 60 * 24) });
    open(fake);
    expect(await rowOf('conceal')).toHaveTextContent('missed 99 or more runs');
  });

  test('a player is told it is an admin\'s and nothing is asked for', async () => {
    const fake = healthy('player');
    const read = vi.spyOn(fake, 'adminJobs');
    open(fake);
    expect(await screen.findByText("The jobs page is for admins.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  test('a read that fails is the page\'s unavailable line, never a stopped job', async () => {
    const fake = healthy();
    vi.spyOn(fake, 'adminJobs').mockRejectedValueOnce(new Error('offline'));
    open(fake);
    expect(await screen.findByRole('alert')).toHaveTextContent('The jobs could not be read. Reload the page to try again.');
    expect(screen.queryByText(/stopped/iu)).toBeNull();
  });

  test('each cell carries its column name, shown to a reader at phone width where the header row is clipped', async () => {
    open(healthy());
    const row = await rowOf('settle');
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.firstElementChild?.textContent)).toEqual(['Schedule ', 'State ']);
    for (const c of cells) expect(c.firstElementChild).toHaveClass('kb-jobs-col');
    /* jsdom does not match :where(), so the stylesheet is read: the label is off on a wide page and visually hidden (never display: none) on the phone. */
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'jobs.css'), 'utf8');
    expect(css).toMatch(/^\.kb-jobs-col \{\s*display: none;/mu);
    expect(css).toMatch(/:where\(:root\[data-kb-layout='phone'\]\) \.kb-jobs-col \{\s*display: inline;[^}]*clip-path: inset\(50%\)/u);
  });

  test('a diagnosis cell names which job it is about', async () => {
    const fake = healthy();
    stopConceal(fake, { status: 'succeeded', message: '1 row' });
    open(fake);
    expect(await screen.findByRole('cell', { name: /^Why conceal stopped:/u })).toBeInTheDocument();
  });

  test('a job that goes late while the page is open turns Stopped without a reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      const fake = healthy();
      fake.seed.job('kayfabb-conceal', { lastOkAt: isoAgo(fake, 1) });
      open(fake);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const rowNow = () => screen.getByRole('rowheader', { name: /^conceal\b/u }).closest('tr')!;
      expect(rowNow()).toHaveTextContent('Running');
      fake.clock.advance(20 * MINUTE);
      await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); });
      expect(rowNow()).toHaveTextContent('Stopped since');
    } finally { vi.useRealTimers(); }
  });
});
