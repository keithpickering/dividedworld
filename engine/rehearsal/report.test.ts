import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportHtml, type LogCall, type LogDay, type RehearsalLog } from './report.ts';

const emptyDay = (day: number): LogDay => ({
  day, date: `2026-12-0${day}`, meetings: [], moves: [], orders: [], visits: [], infractions: [], patrols: [], apologies: [], chatter: [], calls: [], trims: [], costByJob: [], skips: [], filler: { through: 3, refused: 1 },
});
const meeting = {
  id: 1, startedAt: '2026-12-01T00:00:00.000Z', finishedAt: '2026-12-01T00:01:00.000Z', outcome: 'ok', error: null, bankBefore: 2, bankAfter: 1,
  parts: [{ part: 'moves', outcome: 'ok', error: null, sent: { system: 'You are the Boss.', messages: [{ role: 'user', content: 'DIGEST-TEXT' }] }, answer: { moves: [] }, replayed: false }],
  memoryBefore: { hobby: 'before-hobby' }, memoryAfter: { hobby: 'after-hobby' },
};
const move = { id: 5, staff: 'boss', kind: 'rename', why: 'because', demand: { kind: 'postsOnBoard' }, goLiveAt: '2026-12-02T00:00:00.000Z', expiresAt: null, held: false, landedAt: '2026-12-02T00:00:00.000Z', endedHow: 'met', failure: null };
const clean = (): RehearsalLog => ({
  scenario: 'tiny', seed: 7, mode: 'stub', tiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' }, daysRun: 1, day1: '2026-12-01T00:00:00.000Z', systemOnAt: '2026-12-01T00:00:00.000Z',
  cost: { liveMicrodollars: 1500000, replayedMicrodollars: 250000, unmatchedMicrodollars: 0, capDollars: 5 }, notes: [],
  days: [{ ...emptyDay(1), meetings: [meeting], moves: [move], costByJob: [{ job: 'meeting', calls: 1, liveMicrodollars: 1500000, replayedMicrodollars: 0, unmatchedMicrodollars: 0 }] }],
});

test('a move\'s why and a chatter post are text, never markup (the poison)', () => {
  const log = clean();
  const day = log.days[0]!;
  const poisoned: RehearsalLog = {
    ...log,
    days: [{
      ...day,
      moves: [{ ...move, why: '<script>alert(1)</script>' }],
      chatter: [{ at: '2026-12-01T01:00:00.000Z', staff: 'mod', character: "O'Brien & \"Co\"", body: '<img src=x onerror=alert(1)>', call: null }],
    }],
  };
  const html = reportHtml(poisoned);
  assert.ok(!/<script/i.test(html), 'a script tag is in the page');
  assert.ok(!/<img/i.test(html), 'an img tag is in the page');
  assert.ok(!/<[^>]*\bonerror\s*=/i.test(html), 'an event handler is in a tag');
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
  assert.ok(!/<script|@import|url\(/i.test(html));
  for (const m of html.matchAll(/<[^>]*\b(?:src|href)\s*=\s*["']?([^"'\s>]*)/gi)) assert.equal(m[1], '#');
});

test('a URL in the log is shown as text and is no reference', () => {
  const log = clean();
  const html = reportHtml({ ...log, days: [{ ...log.days[0]!, chatter: [{ at: '2026-12-01T01:00:00.000Z', staff: 'mod', character: 'Mo', body: 'see https://example.com/x?a=1&b=2', call: null }] }] });
  assert.ok(html.includes('see https://example.com/x?a=1&amp;b=2'));
  assert.ok(!/<[^>]*\b(?:src|href)\s*=/i.test(html));
});

const call = (over: Partial<LogCall> = {}): LogCall => ({ at: '2026-12-01T02:00:00.000Z', duty: 'chatter', staff: 'mod', replayed: false, costMicrodollars: 0, prompt: 'CHATTER-PROMPT', answer: 'CHATTER-ANSWER', error: null, trims: [], ...over });

test('visits, filings, patrols, apologies and chatter show their words, with the call that made them', () => {
  const log = clean();
  const html = reportHtml({
    ...log,
    days: [{
      ...log.days[0]!,
      visits: [{ at: '2026-12-01T03:00:00.000Z', staff: 'mod', line: 'VISIT-LINE', outcome: 'filed', call: null }],
      infractions: [{ at: '2026-12-01T03:30:00.000Z', kind: 'infraction', payload: { rule: 'FILING-RULE' }, call: call({ duty: 'filing', prompt: 'FILING-PROMPT', answer: 'FILING-ANSWER' }) }],
      patrols: [{ meeting: 1, n: 1, staff: 'mod', at: '2026-12-01T04:00:00.000Z', ranAt: null, sampled: 3, dropped: [{ why: 'PATROL-DROP' }], outcome: { note: 'PATROL-OUTCOME' }, call: call({ duty: 'patrolJudge', prompt: 'PATROL-PROMPT', answer: 'PATROL-ANSWER' }) }],
      apologies: [{ at: '2026-12-01T05:00:00.000Z', character: 'APOLOGIZER', state: 'accepted', call: call({ duty: 'apologyJudge', prompt: 'APOLOGY-PROMPT', answer: 'APOLOGY-ANSWER' }) }],
      chatter: [{ at: '2026-12-01T01:00:00.000Z', staff: 'mod', character: 'Mo', body: 'CHATTER-BODY', call: call() }],
    }],
  });
  for (const w of ['VISIT-LINE', 'FILING-RULE', 'FILING-PROMPT', 'FILING-ANSWER', 'PATROL-DROP', 'PATROL-OUTCOME', 'PATROL-PROMPT', 'PATROL-ANSWER', 'APOLOGIZER', 'APOLOGY-PROMPT', 'APOLOGY-ANSWER', 'CHATTER-BODY', 'CHATTER-PROMPT', 'CHATTER-ANSWER']) assert.ok(html.includes(w), w);
  assert.ok(html.includes('<details'));
});

test('a call with no Act shows under its job, and a rejected answer shows its predicate and reason', () => {
  const log = clean();
  const html = reportHtml({
    ...log,
    days: [{ ...log.days[0]!, calls: [call({ duty: 'reportJudge', prompt: 'REPORT-PROMPT', answer: null, error: { message: 'REJECTED-REASON', predicate: 'minLength 3' }, trims: [{ where: 'x', path: 'p', predicate: 'TRIM-BOUND', before: 9, after: 6 }] })] }],
  });
  for (const w of ['reportJudge', 'REPORT-PROMPT', 'REJECTED-REASON', 'minLength 3', 'TRIM-BOUND']) assert.ok(html.includes(w), w);
});

test('notes (the ledger mismatches) are shown', () => {
  const html = reportHtml({ ...clean(), notes: ['ledger row 9 (chatter) has no kept call'] });
  assert.ok(html.includes('ledger row 9 (chatter) has no kept call'));
});

// Every string in the log carries a marker with a tag, a quote and an ampersand; none may reach the page as markup.
const MARK = '<b>x</b>&"\'';
const marked = (v: unknown): unknown => (typeof v === 'string' ? MARK : Array.isArray(v) ? v.map(marked) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, marked(x)])) : v);

test('a marker planted in every string field of the log never becomes a tag', () => {
  const c = call({ replayed: true, error: { message: 'm', predicate: 'p' }, trims: [{ where: 'w', path: 'p', predicate: 'q', before: 2, after: 1 }] });
  const full: RehearsalLog = {
    ...clean(),
    notes: ['n'],
    days: [{
      ...emptyDay(1),
      meetings: [{ ...meeting, error: 'e', parts: [{ part: 'moves', outcome: 'rejected', error: 'pe', sent: { system: 's', messages: [{ role: 'user', content: 'c' }] }, answer: { a: 'b', list: ['x'] }, replayed: true }], memoryBefore: { h: 'x' }, memoryAfter: 'y' }],
      moves: [{ ...move, held: true, failure: 'f', expiresAt: 'x', demand: { kind: 'k' } }],
      orders: [{ meeting: 1, staff: 's', line: 'l', allowance: 1, boards: 2 }],
      visits: [{ at: 'a', staff: 's', line: 'l', outcome: 'o', call: c }],
      infractions: [{ at: 'a', kind: 'k', payload: { r: 'x' }, call: c }],
      patrols: [{ meeting: 1, n: 1, staff: 's', at: 'a', ranAt: 'r', sampled: 1, dropped: [{ why: 'x' }], outcome: { o: 'x' }, call: c }],
      apologies: [{ at: 'a', character: 'c', state: 's', call: c }],
      chatter: [{ at: 'a', staff: 's', character: 'c', body: 'b', call: c }],
      calls: [c],
      trims: [{ where: 'w', path: 'p', predicate: 'q', before: 2, after: 1 }],
      costByJob: [{ job: 'j', calls: 1, liveMicrodollars: 1, replayedMicrodollars: 1, unmatchedMicrodollars: 1 }],
      skips: [{ at: 'a', what: 'w', why: 'y' }],
    }],
  };
  const html = reportHtml(marked(full) as RehearsalLog);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;&amp;&quot;&#39;'));
  assert.ok(!/<b>/i.test(html), 'a planted <b> tag is in the page');
});

test('the header names both tiers\' models', () => {
  assert.match(reportHtml(clean()), /Models: strong claude-opus-5-5, light claude-haiku-5-5\./);
});

test('a tier the run could not read renders as unset, never as an empty name', () => {
  const log = { ...clean(), tiers: { strong: '', light: 'claude-haiku-5-5' } } as RehearsalLog;
  const html = reportHtml(log);
  assert.match(html, /Models: strong unset, light claude-haiku-5-5\./);
  assert.match(reportHtml({ ...log, tiers: { strong: 'claude-opus-5-5', light: '' } } as RehearsalLog), /Models: strong claude-opus-5-5, light unset\./);
});

test('a meeting shows each of its three parts with its outcome, and a failed part its error', () => {
  const part = (name: string, outcome: string, error: string | null, answer: unknown) => ({ part: name, outcome, error, sent: { system: `SYS-${name}`, messages: [{ role: 'user', content: `ASK-${name}` }] }, answer, replayed: false });
  const log = clean();
  const m = { ...meeting, parts: [part('moves', 'ok', null, { moves: [] }), part('staff', 'failed', 'STAFF-BOOM', null), part('self', 'ok', null, { memory: 'SELF-ANSWER' })] };
  const html = reportHtml({ ...log, days: [{ ...log.days[0]!, meetings: [m] }] });
  for (const name of ['moves', 'staff', 'self']) assert.match(html, new RegExp(`Part ${name}: (ok|failed)`));
  assert.match(html, /Part moves: ok/);
  assert.match(html, /Part staff: failed[^<]*STAFF-BOOM/);
  assert.match(html, /Part self: ok/);
  assert.ok(html.includes('ASK-staff') && html.includes('SELF-ANSWER'));
  assert.ok(!/Part moves: ok[^<]*Error/.test(html), 'an ok part shows no error');
});

test('a meeting with no kept call says so', () => {
  const log = clean();
  const html = reportHtml({ ...log, days: [{ ...log.days[0]!, meetings: [{ ...meeting, parts: [] }] }] });
  assert.match(html, /No call was kept for this meeting/);
});

test('a part with no kept call says so plainly, and the meeting label counts only parts with calls', () => {
  const withCall = { part: 'staff', outcome: 'ok', error: null, sent: { system: 's', messages: [{ role: 'user', content: 'c' }] }, answer: { a: 1 }, replayed: true };
  const noCall = { part: 'moves', outcome: 'failed', error: 'MOVES-BOOM', sent: null, answer: null, replayed: null };
  const log = clean();
  const html = reportHtml({ ...log, days: [{ ...log.days[0]!, meetings: [{ ...meeting, parts: [noCall, withCall] }] }] });
  assert.match(html, /Part moves: failed[^<]*MOVES-BOOM/);
  assert.match(html, /No call was kept for this part\./);
  assert.match(html, /Meeting 1: [^<]*\(replayed; no call was kept for 1 part\)/);
  assert.ok(!/Part moves: failed \(replayed\)/.test(html));
});
