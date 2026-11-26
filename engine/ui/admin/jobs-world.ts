/** The world the jobs page's stories draw: a story's seed, kept out of the story files, whose every export is a story. */
import { JOBS } from '../../rules/jobs.ts';
import type { World } from '../story.tsx';

const MINUTE = 60_000;

/** Every job scheduled every minute with a good run a minute ago, but for conceal when `stopped`, whose last good run was half an hour ago. */
export const jobsWorld = (as: 'admin' | 'player', stopped: boolean): World => (fake) => {
  const now = fake.clock.now();
  for (const j of JOBS) {
    const late = stopped && j.name === 'kayfabb-conceal';
    fake.seed.job(j.name, { lastOkAt: new Date(now - (late ? 30 : 1) * MINUTE).toISOString() });
    fake.seed.jobRun(j.name, { status: 'succeeded', message: j.fn === null ? null : '1 row', at: now - MINUTE });
  }
  const admin = fake.seed.account('jobs-admin', { admin: true });
  const player = fake.seed.account('jobs-player');
  fake.signInAs(as === 'admin' ? admin : player);
};
