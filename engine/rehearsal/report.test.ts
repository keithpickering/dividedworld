import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportHtml, type LogDay, type RehearsalLog } from './report.ts';

const emptyDay = (day: number): LogDay => ({
  day, date: `2026-12-0${day}`, meetings: [], moves: [], orders: [], visits: [], infractions: [], patrols: [], apologies: [], chatter: [], trims: [], costByJob: [], skips: [], filler: { through: 3, refused: 1 },
});
const meeting = {
  id: 1, startedAt: '2026-12-01T00:00:00.000Z', finishedAt: '2026-12-01T00:01:00.000Z', outcome: 'ok', error: null, bankBefore: 2, bankAfter: 1,
  sent: { system: 'You are the Boss.', messages: [{ role: 'user', content: 'DIGEST-TEXT' }] }, answer: { moves: [] },
  memoryBefore: { hobby: 'before-hobby' }, memoryAfter: { hobby: 'after-hobby' }, replayed: false,
};
const move = { id: 5, staff: 'boss', kind: 'rename', why: 'because', demand: { kind: 'postsOnBoard' }, goLiveAt: '2026-12-02T00:00:00.000Z', expiresAt: null, held: false, landedAt: '2026-12-02T00:00:00.000Z', endedHow: 'met', failure: null };
const clean = (): RehearsalLog => ({
  scenario: 'tiny', seed: 7, mode: 'stub', daysRun: 1, day1: '2026-12-01T00:00:00.000Z', systemOnAt: '2026-12-01T00:00:00.000Z',
  cost: { liveMicrodollars: 1500000, replayedMicrodollars: 250000, capDollars: 5 }, notes: [],
  days: [{ ...emptyDay(1), meetings: [meeting], moves: [move], costByJob: [{ job: 'meeting', calls: 1, liveMicrodollars: 1500000, replayedMicrodollars: 0 }] }],
});

test('a move\'s why and a chatter post are text, never markup (the poison)', () => {
  const log = clean();
  const day = log.days[0]!;
  const poisoned: RehearsalLog = {
    ...log,
    days: [{
      ...day,
      moves: [{ ...move, why: '<script>alert(1)</script>' }],
      chatter: [{ at: '2026-12-01T01:00:00.000Z', staff: 'mod', character: "O'Brien & \"Co\"", body: '<img src=x onerror=alert(1)>' }],
    }],
  };
  const html = reportHtml(poisoned);
  assert.ok(!html.includes('<script'), 'a script tag is in the page');
  assert.ok(!html.includes('<img'), 'an img tag is in the page');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('O&#39;Brien &amp; &quot;Co&quot;'));
});

test('a skipped job and a trimmed answer are shown', () => {
  const log = clean();
  const day = log.days[0]!;
  const html = reportHtml({
    ...log,
    days: [{
      ...day,
      skips: [{ at: '2026-12-01T05:00:00.000Z', what: 'chatter', why: 'cost cap reached' }],
      trims: [{ where: 'meeting 1', path: 'moves', predicate: 'maxItems 6', before: 7, after: 6 }],
    }],
  });
  assert.ok(html.includes('cost cap reached') && html.includes('chatter'));
  assert.ok(html.includes('maxItems 6') && html.includes('moves'));
});

test('the page is whole: the meeting, memory side by side, cost, and nothing external', () => {
  const html = reportHtml(clean());
  for (const s of ['DIGEST-TEXT', 'before-hobby', 'after-hobby', 'tiny', 'prefers-color-scheme', '$1.50', '$0.25', 'met', '<details']) assert.ok(html.includes(s), s);
  assert.ok(!/<script|@import|url\(|https?:/i.test(html));
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']?([^"'\s>]*)/gi)) assert.equal(m[1], '#');
});
