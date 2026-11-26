import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANNOUNCE_MOST, PITCH_MOST, RECAP_MOST, announceRepair, beatsText, leadInMoods, leadInText, plotText, pushOf, recapFallback, shownBeats, type ArcRead, type PlotRead } from './beats.ts';
import type { HandoffFacts } from './meeting.ts';
import type { Beat, Persona } from '../rules/types.ts';

// The arc announcements design, sections 2, 3, 5, 6, 7 and 8, over the engine's own fixture: nothing here is an instance's content.
const ANNOUNCED: Beat = {
  key: 'the-split',
  unlock: [{ kind: 'phase', phase: 'reign' }],
  brief: 'SPLIT-BRIEF a private idea.',
  announce: { titleHint: 'a proud name for a big decision', defaultTitle: 'A Big Decision', defaultBody: 'I have decided. It is done.', defaultPitch: 'Everything is changing.', push: 'PUSH-LINE talk it up' },
  leadIn: { unlock: [{ kind: 'phase', phase: 'honeymoon' }], brief: 'LEAD-BRIEF the board feels crowded.', mood: 'MOOD-LINE cramped' },
};
const QUIET: Beat = { key: 'quiet-lap', unlock: [{ kind: 'phase', phase: 'reign' }], brief: 'QUIET-BRIEF tidy up.' };
const CLEANUP: Beat = {
  key: 'cleanup',
  unlock: [{ kind: 'beatLanded', beat: 'the-split', of: 'predecessor' }],
  brief: 'CLEANUP-BRIEF your predecessor merged it all.',
  announce: { titleHint: 'a tidy-up', defaultTitle: 'Tidying', defaultBody: 'Cleaning.', defaultPitch: 'Back to normal.', push: 'CLEANUP-PUSH' },
  leadIn: { unlock: [], brief: 'AFTER-LEAD the mess nags you.', mood: 'AFTER-MOOD uneasy' },
};
const me: Pick<Persona, 'arc' | 'miniArcs' | 'aftermath'> = { arc: [ANNOUNCED], miniArcs: [QUIET] };
const old: Pick<Persona, 'key' | 'aftermath'> = { key: 'fangame', aftermath: [CLEANUP] };
const read = (beats: ArcRead['beats'], leadIns?: string[]): ArcRead => ({ beats, heldBack: [], ...(leadIns ? { leadIns } : {}) });

test('shownBeats finds an aftermath beat in the predecessor\'s file by its plain key, and shows none for a predecessor off the roster', () => {
  const r = read([{ key: 'the-split', mini: false, due: false }, { key: 'cleanup', mini: false, due: false, aftermath: true, predecessor: 'fangame' }]);
  const shown = shownBeats(me, r, [old]);
  assert.deepEqual(shown.map((b) => [b.beat.key, b.aftermath ?? false]), [['the-split', false], ['cleanup', true]]);
  assert.deepEqual(shownBeats(me, r, []).map((b) => b.beat.key), ['the-split'], 'a predecessor no longer on the roster shows none');
  assert.deepEqual(shownBeats(me, r).map((b) => b.beat.key), ['the-split'], 'no roster given, none');
  assert.deepEqual(shownBeats(me, read([{ key: 'cleanup', mini: false, due: false, aftermath: true, predecessor: 'someone-else' }]), [old]), [], 'a predecessor whose file lacks it');
  assert.deepEqual(shownBeats(me, read([{ key: 'cleanup', mini: false, due: false }]), [old]), [], 'a beat listed as the Boss\'s own is looked for in its own file only');
});

test('an announced beat names the sticky thread, the title hint and the bounds, and a beat with no block says nothing new', () => {
  const text = beatsText(shownBeats(me, read([{ key: 'the-split', mini: false, due: false }, { key: 'quiet-lap', mini: true, due: false }])), 90).join('\n');
  const [first, second] = [text.slice(text.indexOf('- the-split'), text.indexOf('- quiet-lap')), text.slice(text.indexOf('- quiet-lap'))];
  assert.match(first, /sticky thread on the staff board in your name/);
  assert.ok(first.includes('a proud name for a big decision') && first.includes('at most 90 characters'), first);
  assert.ok(first.includes(`at most ${ANNOUNCE_MOST} characters`) && first.includes(`at most ${PITCH_MOST} characters`), first);
  assert.match(first, /every staff member will carry/);
  assert.ok(!/sticky|announce/.test(second.split('\n').slice(0, 2).join('\n')), second);
});

test('announceRepair: blanks are the block\'s defaults and recorded; a long field is cut at a sentence else a word, recorded; a beat with no block drops it', () => {
  const blank = announceRepair(ANNOUNCED, { title: '  ', body: '', pitch: 7 }, 40, 'beats[0]');
  assert.deepEqual([blank.announcement!.title, blank.announcement!.body, blank.announcement!.pitch, blank.announcement!.push], ['A Big Decision', 'I have decided. It is done.', 'Everything is changing.', 'PUSH-LINE talk it up']);
  assert.deepEqual(blank.trims.map((t) => [t.path, t.predicate]), [['beats[0].announce.title', 'defaulted'], ['beats[0].announce.body', 'defaulted'], ['beats[0].announce.pitch', 'defaulted']]);
  const long = announceRepair(ANNOUNCED, { title: 'Short one. Then a very long second sentence that overshoots', body: `${'Word. '.repeat(500)}`, pitch: `${'x'.repeat(PITCH_MOST - 5)} overshoot here` }, 40, 'p');
  assert.equal(long.announcement!.title, 'Short one.', 'cut at the sentence');
  assert.ok(long.announcement!.body.length <= ANNOUNCE_MOST && long.announcement!.body.endsWith('Word.'));
  assert.ok(long.announcement!.pitch.length <= PITCH_MOST);
  assert.deepEqual(long.trims.map((t) => t.path), ['p.announce.title', 'p.announce.body', 'p.announce.pitch']);
  assert.ok(long.trims.every((t) => t.predicate.startsWith('maxLength(') && t.after < t.before));
  const none = announceRepair(QUIET, { title: 'Hi', body: 'There', pitch: 'x' }, 40, 'p');
  assert.equal(none.announcement, null);
  assert.deepEqual(none.trims, [{ path: 'p.announce', predicate: 'hasAnnounce', before: 1, after: 0 }]);
  assert.deepEqual(announceRepair(QUIET, { title: '', body: ' ', pitch: '' }, 40, 'p').trims, [], 'an all-blank block on a beat with none is nothing written');
  const due = announceRepair(ANNOUNCED, 'defaults', 40, 'p');
  assert.equal(due.announcement!.title, 'A Big Decision');
  assert.deepEqual(due.trims, [], 'a due beat takes every default and the caller records it once');
});

test('a lead-in shows its brief as a feeling and never the beat\'s own brief or key; a beat not listed is absent', () => {
  const text = leadInText(me, ['the-split'], []).join('\n');
  assert.ok(text.includes('LEAD-BRIEF the board feels crowded.'));
  assert.ok(!text.includes('SPLIT-BRIEF') && !text.includes('the-split') && !text.includes('MOOD-LINE'), text);
  assert.match(text, /not a plan/);
  assert.deepEqual(leadInText(me, [], []), []);
  assert.deepEqual(leadInText(me, undefined), []);
  assert.deepEqual(leadInText(me, ['quiet-lap'], []), [], 'a beat with no lead-in');
  assert.deepEqual(leadInText(me, ['gone'], []), []);
  assert.deepEqual(leadInText({ arc: [{ ...ANNOUNCED, leadIn: undefined }] }, ['the-split']), [], 'a beat the file holds with no lead-in block shows none');
  // The persona holds the beat, but the database lists no lead-in for it: nothing of it is in the text.
  assert.ok(!leadInText({ arc: [ANNOUNCED, { ...QUIET, key: 'locked', leadIn: { unlock: [], brief: 'LOCKED-LEAD', mood: 'LOCKED-MOOD' } }] }, ['the-split']).join('').includes('LOCKED'));
});

test('an aftermath beat\'s lead-in is listed as after:<predecessor>:<key> and read from the predecessor\'s file', () => {
  assert.ok(leadInText(me, ['after:fangame:cleanup'], [old]).join('\n').includes('AFTER-LEAD'));
  assert.deepEqual(leadInText(me, ['after:fangame:cleanup'], []), [], 'a predecessor off the roster');
  assert.deepEqual(leadInMoods(me, ['the-split', 'after:fangame:cleanup', 'quiet-lap'], [old]), ['MOOD-LINE cramped', 'AFTER-MOOD uneasy']);
});

const facts = (over: Partial<HandoffFacts> = {}): HandoffFacts => ({
  created: [{ board: 'a', name: 'World -1' }, { board: 'b', name: 'Fangames' }], merged: [{ board: 'c', name: 'Old', into: 'a', intoName: 'World -1' }], closed: [],
  beats: [{ staff: 'fangame', beat: 'the-split', at: '2026-10-20T09:00:00Z' }], moves: [], busiest: [{ board: 'a', name: 'World -1', posts: 14 }], quietest: [], ...over,
});

test('recapFallback is one plain line from the facts, within RECAP_MOST', () => {
  const line = recapFallback(facts(), 'FanGaME');
  assert.equal(line, 'Last season: FanGaME led. 2 boards made, 1 merged. 1 beat played. World -1 was the busiest board.');
  assert.equal(recapFallback(facts({ created: [], merged: [], beats: [], busiest: [] }), 'FanGaME'), 'Last season: FanGaME led. No board was made, merged or closed.');
  const huge = recapFallback(facts({ busiest: [{ board: 'a', name: 'n'.repeat(400), posts: 1 }] }), 'B'.repeat(400));
  assert.ok(huge.length <= RECAP_MOST, String(huge.length));
});

const plot = (over: Partial<PlotRead> = {}): PlotRead => ({
  last: { boss: 'fangame', name: 'FanGaME', recap: 'I put everything in World -1. You are welcome.', facts: facts() },
  initiatives: [{ beat: 'the-split', title: 'The Split', pitch: 'Fangames get their own board.', thread: 'thread-1', boss: 'sitting' }], ...over,
});

test('the plot so far reads last season\'s recap and each initiative, with the push for the sitting Boss only', () => {
  const push = pushOf(me, [old]);
  const mod = plotText(plot(), { key: 'a-mod', boss: false }, push).join('\n');
  assert.ok(mod.includes('Last season FanGaME was the Boss. This is how they summed it up: I put everything in World -1. You are welcome.'), mod);
  assert.ok(mod.includes('"The Split" (thread thread-1): Fangames get their own board.'));
  assert.ok(!mod.includes('PUSH-LINE') && !mod.includes('You announced'), mod);
  const boss = plotText(plot(), { key: 'sitting', boss: true }, push).join('\n');
  assert.ok(boss.includes('Your push: PUSH-LINE talk it up'), boss);
  // The push is found for an aftermath initiative by `after:<predecessor>:<key>` or by its plain key.
  assert.equal(push('after:fangame:cleanup'), 'CLEANUP-PUSH');
  assert.equal(push('cleanup'), 'CLEANUP-PUSH');
  assert.equal(push('quiet-lap'), undefined);
});

test('a former Boss reads the plot in the second person, and no push line goes to a persona that is not the Boss', () => {
  const former = plotText(plot({ initiatives: [{ beat: 'the-split', title: 'The Split', pitch: 'p', thread: 't', boss: 'fangame' }] }), { key: 'fangame', boss: false }, pushOf(me, [old])).join('\n');
  assert.ok(former.includes('Last season you were the Boss. This is how you summed it up: I put everything'), former);
  assert.ok(former.includes('You announced this.') && !former.includes('PUSH-LINE'), former);
});

test('the recap falls back to the facts where the last meeting wrote none, and the plot says nothing where there is nothing', () => {
  const text = plotText(plot({ last: { boss: 'fangame', name: 'FanGaME', recap: '  ', facts: facts() }, initiatives: [] }), { key: 'x', boss: false }).join('\n');
  assert.ok(text.includes(recapFallback(facts(), 'FanGaME')), text);
  assert.deepEqual(plotText(undefined, { key: 'x', boss: false }), []);
  assert.deepEqual(plotText({ last: null, initiatives: [] }, { key: 'x', boss: true }), []);
  assert.ok(plotText({ last: { boss: 'f', name: 'F', recap: null, facts: null }, initiatives: [] }, { key: 'x', boss: false }).join('').includes('Last season F was the Boss.'));
  assert.ok(plotText(plot({ last: { boss: 'f', name: 'F', recap: 'r'.repeat(400), facts: null } }), { key: 'x', boss: false }).join('').length < 700, 'a recap past its bound is cut before it is read');
});
