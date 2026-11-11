/**
 * The notice a filed visit leaves on its post (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/02-filed-author.png): "This post was found in violation of
 * Rule 2: No double posting." as a bordered italic line at the top of the body, in the board's world, the post's words under it and never replaced. The warn meter in the
 * author's postbit shows what landed.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { VisitCharge } from '../data/api.ts';
import { LoadedThread } from '../loaded.tsx';
import { buildWorld, renderIn } from '../test-world.tsx';
import { noticeWords } from './visit.ts';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the notice\'s words', () => {
  const charge = (over: Partial<VisitCharge> = {}): VisitCharge => ({ rule: 'Rule 2: No double posting', ruleNumber: 2, band: 'minor', cause: 'rule', ...over });
  test('names the heaviest charge\'s rule as the catalog says it', () => {
    expect(noticeWords([charge()])).toBe('This post was found in violation of Rule 2: No double posting.');
    expect(noticeWords([charge(), charge({ rule: 'Rule 5: No all caps', ruleNumber: 5, band: 'severe' })])).toBe('This post was found in violation of Rule 5: No all caps.');
  });
  test('puts the rule\'s number to words that came without it, and names the premise where the charge named no rule', () => {
    expect(noticeWords([charge({ rule: 'No double posting' })])).toBe('This post was found in violation of Rule 2: No double posting.');
    expect(noticeWords([charge({ rule: null, ruleNumber: null })])).toBe('This post was found in violation of the board\'s premise.');
    expect(noticeWords([charge({ rule: null, ruleNumber: null, cause: 'tail' })])).toBe('This post was found in violation of Obstruction.');
  });
  test('says an appeal overturned the finding, and says nothing more for the others', () => {
    expect(noticeWords([charge({ rule: 'House Rule 1: Be kind', ruleNumber: 1 })])).toBe('This post was found in violation of House Rule 1: Be kind.');
    expect(noticeWords([charge()], 'overturned')).toBe('This post was found in violation of Rule 2: No double posting. On appeal, that finding was overturned.');
    for (const r of ['upheld', 'reduced', 'increased', undefined]) expect(noticeWords([charge()], r)).toBe('This post was found in violation of Rule 2: No double posting.');
  });
  test('says what a backfired report\'s charge was, and nothing where there is no charge', () => {
    expect(noticeWords([charge({ rule: null, ruleNumber: null, cause: 'backfire' })])).toBe('This post was found to be a waste of the staff\'s time.');
    expect(noticeWords([])).toBeNull();
  });
});

describe('a post a visit filed on', () => {
  function world() {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const clerk = fake.seed.staff('clerk', 'The Clerk', 'mod');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'Third time this week.');
    fake.signInAs(me);
    return { fake, pipe, spritey, clerk, thread, second };
  }
  const open = (w: ReturnType<typeof world>) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, copy: { modRole: 'A Moderator' } });
  const article = (seq: number) => screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });

  test('shows the notice as a bordered italic line at the top of the body, with the post\'s words under it', async () => {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.second, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    open(w);
    const post = await article(2);
    const notice = post.querySelector('.kb-violation')!;
    expect(notice).toHaveTextContent('This post was found in violation of Rule 2: No double posting.');
    const body = post.querySelector('.kb-act-main')!;
    expect(body.firstElementChild).toBe(notice);
    expect(within(body as HTMLElement).getByText('Third time this week.')).toBeInTheDocument();
    expect(notice.compareDocumentPosition(within(body as HTMLElement).getByText('Third time this week.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('shows none while the visit is open, and none on a post nobody visited', async () => {
    const w = world();
    w.fake.seed.visit(w.clerk, w.second, { at: Date.now(), endsInMs: 3_600_000 });
    open(w);
    await article(2);
    expect(document.querySelector('.kb-violation')).toBeNull();
  });

  test('shows none after the visit was talked down', async () => {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.second, { at: Date.now() - 3_600_000, endsInMs: 60_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'intercepted', line: 'Talked down.' });
    open(w);
    await article(2);
    expect(document.querySelector('.kb-violation')).toBeNull();
  });

  test('says on the notice that an appeal overturned the finding, with the post\'s words still under it; an upheld appeal leaves the notice as it was', async () => {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.second, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    const inf = w.fake.seed.infraction(visit, { points: 2 });
    const appeal = w.fake.seed.appeal(w.spritey, inf, 'Please.');
    w.fake.seed.ruling(appeal, w.clerk, 'overturned');
    open(w);
    const post = await article(2);
    expect(post.querySelector('.kb-violation')).toHaveTextContent('This post was found in violation of Rule 2: No double posting. On appeal, that finding was overturned.');
    expect(within(post).getByText('Third time this week.')).toBeInTheDocument();
  });

  test('keeps the notice as it was on an upheld appeal', async () => {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.second, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    const inf = w.fake.seed.infraction(visit, { points: 2 });
    w.fake.seed.ruling(w.fake.seed.appeal(w.spritey, inf, 'Please.'), w.clerk, 'upheld');
    open(w);
    expect((await article(2)).querySelector('.kb-violation')?.textContent).toBe('This post was found in violation of Rule 2: No double posting.');
  });

  test('puts the warn meter in the author\'s postbit once the infraction has landed, and none before', async () => {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.second, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    w.fake.seed.infraction(visit, { points: 6, band: 'severe' });
    open(w);
    const post = await article(2);
    expect(await within(post).findByRole('img', { name: 'Warnings: 6/10' })).toBeInTheDocument();
    /* Post 1 is by the same character, whose bar is the same: the meter is the character's, on each of its posts. */
    expect(within(await article(1)).getByRole('img', { name: 'Warnings: 6/10' })).toBeInTheDocument();
  });

  test('says BANNED on the title line of a banned character\'s posts', async () => {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.second, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    const inf = w.fake.seed.infraction(visit, { points: 10, band: 'severe' });
    w.fake.seed.ban(w.spritey, Date.now() + 3_600_000, { infraction: inf });
    open(w);
    const post = await article(2);
    await waitFor(() => expect(post.querySelector('.kb-postbit-title')).toHaveTextContent('BANNED'));
  });

  test('passes axe with the notice and the meter drawn', async () => {
    const w = world();
    const visit = w.fake.seed.visit(w.clerk, w.second, { at: Date.now() - 4 * 3_600_000, endsInMs: 3_600_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    w.fake.seed.infraction(visit, { points: 6, band: 'severe' });
    open(w);
    const post = await article(2);
    await within(post).findByRole('img', { name: 'Warnings: 6/10' });
    const bad = await axeViolations(post);
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});
