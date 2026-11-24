import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerWords } from './exchange.ts';
import type { Act } from '../data/api.ts';

const now = Date.parse('2026-11-24T12:00:00Z');
const past = '2026-11-20T10:00:00Z';
const future = '2026-12-01T09:00:00Z';
const visit = '5f0c2a1e-8d3b-4c6a-9e2f-1a2b3c4d5e6f';

/** A minimal report_verdict or appeal_ruling Act: only the fields answerWords reads are meaningful. */
const act = (kind: 'report_verdict' | 'appeal_ruling', payload: Record<string, unknown>): Act =>
  ({ id: '1', character: null, kind, thread: '2', targetActId: null, seq: null, createdAt: now.toString(), payload }) as unknown as Act;

test('a report verdict says what it did, and a backfire names the reporter', () => {
  assert.equal(answerWords(act('report_verdict', { verdict: 'visit', visit_act: visit }), null, 'Kassie', 'Wario', now),
    'Kassie sent a visit to the post.');
  assert.equal(answerWords(act('report_verdict', { verdict: 'visit' }), null, 'Kassie', 'Wario', now),
    'Kassie judged it a visit, but no visit opened.');
  assert.equal(answerWords(act('report_verdict', { verdict: 'dismissed' }), null, 'Kassie', 'Wario', now),
    'Kassie dismissed it. No visit opened.');
  assert.equal(answerWords(act('report_verdict', { verdict: 'backfire', visit_act: visit }), null, 'Kassie', 'Wario', now),
    'Kassie judged it a backfire: a visit went to Wario\'s latest post.');
  assert.equal(answerWords(act('report_verdict', { verdict: 'backfire' }), null, 'Kassie', 'Wario', now),
    'Kassie judged it a backfire, but no visit opened.');
});

test('an upheld appeal says nothing changed', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'upheld' }), 'infraction', 'The Boss', 'Wario', now),
    'The Boss upheld it. Nothing changed.');
});

test('an overturned warn-point ruling says how many points came off, singular for one', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'overturned', points_delta: -2 }), 'infraction', 'The Boss', 'Wario', now),
    'The Boss overturned it: 2 points came off.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'overturned', points_delta: -1 }), 'infraction', 'The Boss', 'Wario', now),
    'The Boss overturned it: 1 point came off.');
});

test('a reduced warn-point ruling says how many points came off, singular for one', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced', points_delta: -3 }), 'infraction', 'Kassie', 'Wario', now),
    'Kassie reduced it: 3 points came off.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced', points_delta: -1 }), 'infraction', 'Kassie', 'Wario', now),
    'Kassie reduced it: 1 point came off.');
});

test('a reduced warn-point ruling with no points off drops the clause after the colon', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced', points_delta: 0 }), 'infraction', 'Kassie', 'Wario', now),
    'Kassie reduced it.');
});

test('an increased warn-point ruling says how many more points landed, singular for one', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'increased', points_delta: 2 }), 'infraction', 'Kassie', 'Wario', now),
    'Kassie increased it: 2 more points landed.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'increased', points_delta: 1 }), 'infraction', 'Kassie', 'Wario', now),
    'Kassie increased it: 1 more point landed.');
});

test('an overturned ban or move always says it ended, with its until in UTC', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'overturned', until: past }), 'ban', 'The Boss', 'Wario', now),
    'The Boss overturned it: it ended Nov 20 · 10:00 UTC.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'overturned', until: future }), 'move', 'The Boss', 'Wario', now),
    'The Boss overturned it: it ended Dec 1 · 09:00 UTC.');
});

test('a reduced ban or move says it ends, or ended once its until is at or before now', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced', until: future }), 'ban', 'Kassie', 'Wario', now),
    'Kassie reduced it: it ends Dec 1 · 09:00 UTC.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced', until: past }), 'move', 'Kassie', 'Wario', now),
    'Kassie reduced it: it ended Nov 20 · 10:00 UTC.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced', until: new Date(now).toISOString() }), 'ban', 'Kassie', 'Wario', now),
    'Kassie reduced it: it ended Nov 24 · 12:00 UTC.');
});

test('an increased ban or move says it was lengthened, and ends or ended by its until', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'increased', until: future }), 'ban', 'Kassie', 'Wario', now),
    'Kassie lengthened it: it ends Dec 1 · 09:00 UTC.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'increased', until: past }), 'move', 'Kassie', 'Wario', now),
    'Kassie lengthened it: it ended Nov 20 · 10:00 UTC.');
});

test('a verdict or ruling the words do not know says it ruled on it', () => {
  assert.equal(answerWords(act('report_verdict', { verdict: 'mystery' }), null, 'Kassie', 'Wario', now), 'Kassie ruled on it.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'mystery' }), 'ban', 'Kassie', 'Wario', now), 'Kassie ruled on it.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'mystery' }), 'infraction', 'Kassie', 'Wario', now), 'Kassie ruled on it.');
});

test('an upheld ban changes nothing', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'upheld' }), 'ban', 'The Boss', 'Wario', now), 'The Boss upheld it. Nothing changed.');
});

test('a ban ruling with no until, or one that is no time, says nothing of when', () => {
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'overturned' }), 'ban', 'The Boss', 'Wario', now), 'The Boss overturned it: it ended.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced' }), 'ban', 'Kassie', 'Wario', now), 'Kassie reduced it: it ends.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'reduced', until: 'not a time' }), 'ban', 'Kassie', 'Wario', now), 'Kassie reduced it: it ends.');
  assert.equal(answerWords(act('appeal_ruling', { verdict: 'increased', until: 'not a time' }), 'move', 'Kassie', 'Wario', now), 'Kassie lengthened it: it ends.');
});
