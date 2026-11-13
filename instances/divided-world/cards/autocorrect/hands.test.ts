/**
 * The hands (docs/plans/2026-11-11-autocorrect-tape-plan.md, Task 7): the pick, the pull, the roll, the strain and the tear of the
 * author's peel, and a reader's peek, as a state machine with no DOM. Time is the tick's own `dt`, so nothing here waits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hands, type HandEvent, type PieceSpec } from './hands.ts';

const SETTINGS = { pace: 90, pickMs: 450, give: 34, peekStayMs: 300, peekSettle: 300, reduced: false };
const piece = (o: Partial<PieceSpec> = {}): PieceSpec => ({ id: 's:0:0', strip: 's:0', index: 0, w: 200, h: 20, stuck: [[0, 200, 0]], open: true, under: [], ...o });
const make = (specs: PieceSpec[], author = true, over: Partial<typeof SETTINGS> = {}) => {
  const hands = new Hands({ ...SETTINGS, ...over, author });
  hands.sync(specs);
  return hands;
};
/** Time passes in frames of 16 milliseconds. */
const run = (h: Hands, ms: number) => { for (let t = 0; t < ms; t += 16) h.tick(Math.min(16, ms - t)); };
const lo = (h: Hands, id = 's:0:0') => h.view(id).stuck[0]?.[0] ?? 0;
/** A hand that keeps `lead` pixels ahead of the peel line, as a careful one does. */
const follow = (h: Hands, ms: number, lead = 10, id = 's:0:0') => { for (let t = 0; t < ms; t += 16) { h.move(1, lo(h, id) + lead); h.tick(16); } };
const kinds = (h: Hands, id = 's:0:0') => h.view(id).stuck.map(([, , e]) => [Math.floor(e / 3), e % 3]);
const events = (h: Hands, kind: HandEvent['kind']) => h.drain().filter((e) => e.kind === kind);

test('a press at an end, held for pickMs, starts a peel; let go early it does not', () => {
  const held = make([piece()]);
  assert.equal(held.press('s:0:0', 3, 1), 'picking');
  run(held, 200);
  assert.ok(held.view('s:0:0').corner, 'the corner lifts as the hold goes on');
  assert.ok(held.view('s:0:0').corner!.t > 0.3 && held.view('s:0:0').corner!.t < 0.6);
  held.move(1, 60);
  run(held, 100);
  assert.equal(lo(held), 0, 'the line has not moved before the pick is up');
  run(held, 200);
  held.move(1, 60);
  run(held, 500);
  assert.ok(lo(held) > 20, `the peel line follows the hand once the pick is up (${lo(held)})`);
  assert.deepEqual(kinds(held), [[1, 0]]);

  const early = make([piece()]);
  early.press('s:0:0', 3, 1);
  run(early, 300);
  early.release(1);
  assert.equal(early.view('s:0:0').corner, null, 'the corner drops back');
  early.move(1, 100);
  run(early, 600);
  assert.equal(lo(early), 0);
  assert.deepEqual(early.view('s:0:0').stuck, [[0, 200, 0]]);
});

test('a press away from an end does nothing', () => {
  const h = make([piece()]);
  assert.equal(h.press('s:0:0', 100, 1), 'none');
  run(h, 1000);
  assert.equal(h.view('s:0:0').corner, null);
  assert.deepEqual(h.view('s:0:0').stuck, [[0, 200, 0]]);
  assert.equal(h.busy(), false);
});

test('either end works: a press at the far end peels from there', () => {
  const h = make([piece()]);
  assert.equal(h.press('s:0:0', 197, 1), 'picking');
  run(h, 450);
  h.move(1, 150);
  run(h, 500);
  const [from, to, edges] = h.view('s:0:0').stuck[0]!;
  assert.equal(from, 0);
  assert.ok(to < 200 && to > 150);
  assert.equal(edges, 1, 'its own end at the start, a peel line at the end');
});

test('a pull past give for long enough tears; then it needs a new pick at the torn end', () => {
  const h = make([piece({ w: 400, stuck: [[0, 400, 0]] })]);
  h.press('s:0:0', 3, 1);
  run(h, 450);
  h.move(1, 300);
  run(h, 100);
  assert.ok(h.view('s:0:0').strain!.amount > 0, 'the stretch whitens');
  assert.equal(events(h, 'torn').length, 0);
  run(h, 1500);
  const torn = events(h, 'torn');
  assert.equal(torn.length, 1, 'it tore once');
  assert.equal(events(h, 'drop').length, 0, 'drained already');
  assert.deepEqual(kinds(h), [[2, 0]], 'a tear is the start edge now');
  assert.equal(h.view('s:0:0').rolls.length, 0, 'the roll dropped');
  const at = lo(h);
  h.move(1, 380);
  run(h, 1000);
  assert.equal(lo(h), at, 'a torn strip stays put without a new pick');
  h.release(1);
  assert.equal(h.press('s:0:0', at + 4, 2), 'picking');
  run(h, 400);
  h.move(2, at + 40);
  run(h, 32);
  assert.equal(lo(h), at, 'not before the pick is up');
  run(h, 60);
  h.move(2, at + 40);
  run(h, 300);
  assert.ok(lo(h) > at, 'then it peels again');
});

test('a hand within give never strains, however slowly it goes', () => {
  const h = make([piece({ w: 400, stuck: [[0, 400, 0]] })]);
  h.press('s:0:0', 3, 1);
  run(h, 450);
  follow(h, 3000, 20);
  assert.equal(h.view('s:0:0').strain, null);
  assert.ok(lo(h) > 200);
});

test('a roll left waiting needs no pick', () => {
  const h = make([piece()]);
  h.press('s:0:0', 3, 1);
  run(h, 450);
  follow(h, 1000);
  const where = lo(h);
  assert.ok(where > 60);
  h.release(1);
  assert.equal(h.view('s:0:0').rolls.length, 1, 'the roll waits at the peel line');
  assert.equal(h.view('s:0:0').rolls[0]!.x, where);
  assert.equal(h.press('s:0:0', where + 4, 1), 'peeling', 'no pick');
  assert.equal(h.view('s:0:0').corner, null);
  follow(h, 160);
  assert.ok(lo(h) > where + 5, `it carried on within a tenth of a second (${lo(h)} from ${where})`);
});

test('a roll left waiting is the saved peel line: loaded as a stretch with kind 1 it waits for a hand with no pick', () => {
  const h = make([piece({ stuck: [[80, 200, 3]] })]);
  assert.equal(h.view('s:0:0').rolls[0]!.x, 80);
  assert.equal(h.press('s:0:0', 84, 1), 'peeling');
});

test('the whole piece peeled drops the roll and says the strip is off', () => {
  const h = make([piece({ w: 60, stuck: [[0, 60, 0]] })]);
  h.press('s:0:0', 3, 1);
  run(h, 450);
  follow(h, 1200);
  const out = h.drain();
  assert.equal(out.filter((e) => e.kind === 'drop').length, 1);
  assert.equal(out.filter((e) => e.kind === 'off').length, 1);
  assert.deepEqual(h.view('s:0:0').stuck, []);
  assert.deepEqual(h.sharesOf('s:0'), []);
});

test('a strip of two pieces is off only once both are', () => {
  const two = [piece({ id: 's:0:0', w: 40, stuck: [[0, 40, 0]] }), piece({ id: 's:0:1', index: 1, w: 40, stuck: [[0, 40, 0]] })];
  const h = make(two);
  h.press('s:0:0', 3, 1);
  run(h, 450);
  follow(h, 800);
  h.release(1);
  const first = h.drain();
  assert.equal(first.filter((e) => e.kind === 'off').length, 0);
  assert.deepEqual(h.sharesOf('s:0'), [[0.5, 1, 3]], 'what is left starts where the line broke: a peel line, never a tear');
  h.press('s:0:1', 3, 1);
  run(h, 450);
  follow(h, 800, 10, 's:0:1');
  assert.equal(h.drain().filter((e) => e.kind === 'off').length, 1);
});

test('the keyboard picks for pickMs, then peels at pace, and cannot tear', () => {
  const h = make([piece({ w: 400, stuck: [[0, 400, 0]] })]);
  assert.equal(h.keyDown('s:0'), true);
  run(h, 400);
  assert.equal(lo(h), 0);
  run(h, 50);
  run(h, 1000);
  assert.ok(Math.abs(lo(h) - 90) < 4, `about one second at pace (${lo(h)})`);
  assert.equal(h.view('s:0:0').strain, null);
  run(h, 3000);
  assert.equal(events(h, 'torn').length, 0);
  h.keyUp();
  assert.equal(h.view('s:0:0').rolls.length, 1, 'what is done is kept; the roll waits');
});

test('the keyboard takes the end that has a roll, else the start; held again it needs no pick', () => {
  const h = make([piece({ stuck: [[0, 120, 1]] })]);
  assert.equal(h.keyDown('s:0'), true);
  run(h, 200);
  assert.ok(h.view('s:0:0').stuck[0]![1] < 120, 'peeled from the end whose roll waits, with no pick');
  h.keyUp();
  const fresh = make([piece()]);
  fresh.keyDown('s:0');
  run(fresh, 460 + 500);
  assert.ok(lo(fresh) > 30);
});

test('pressing a covered piece says so and moves nothing', () => {
  const h = make([piece({ open: false })]);
  assert.equal(h.press('s:0:0', 3, 1), 'covered');
  assert.equal(events(h, 'covered').length, 1);
  run(h, 1000);
  assert.deepEqual(h.view('s:0:0').stuck, [[0, 200, 0]]);
  assert.equal(h.keyDown('s:0'), false);
});

const chain = () => [piece({ id: 'a:0', strip: 'a', w: 100, stuck: [[0, 100, 0]], under: ['b:0'] }), piece({ id: 'b:0', strip: 'b', w: 80, open: false, stuck: [[0, 80, 0]] })];

test('a peek pulled 150px over [100, 80] lifts [100, 50]', () => {
  const h = make(chain(), false);
  assert.equal(h.press('a:0', 0, 1), 'peeking');
  h.move(1, 150);
  run(h, 16);
  assert.equal(h.view('a:0').lift!.lift, 100);
  assert.equal(h.view('b:0').lift!.lift, 50);
  assert.equal(h.view('a:0').lift!.side, 'a');
  assert.deepEqual(h.view('a:0').shown, [], 'the lifted tape is no longer over the words');
  assert.deepEqual(h.view('b:0').shown, [[50, 80, 0]]);
  assert.equal(h.drain().filter((e) => e.kind === 'change').length, 0, 'nothing a reader does is saved');
});

test('a peek spends no pull on a lower piece already peeled off: the next one with tape comes up after the top', () => {
  const h = make([
    piece({ id: 'a:0', strip: 'a', w: 100, stuck: [[0, 100, 0]], under: ['b:0', 'c:0'] }),
    piece({ id: 'b:0', strip: 'b', w: 80, open: false, stuck: [] }),
    piece({ id: 'c:0', strip: 'c', w: 60, open: false, stuck: [[0, 60, 0]] }),
  ], false);
  assert.equal(h.press('a:0', 0, 1), 'peeking');
  h.move(1, 150);
  run(h, 16);
  assert.equal(h.view('c:0').lift?.lift, 50);
});

test('a peek can come from the far end', () => {
  const h = make(chain(), false);
  h.press('a:0', 97, 1);
  h.move(1, 47);
  run(h, 16);
  assert.equal(h.view('a:0').lift!.side, 'b');
  assert.equal(h.view('a:0').lift!.lift, 53, 'the 3px between the grip and the end count');
});

test('a peek let go holds for the stay, then lays down at the settle speed, the last lifted first', () => {
  const h = make(chain(), false);
  h.press('a:0', 0, 1);
  h.move(1, 150);
  run(h, 16);
  h.release(1);
  run(h, 280);
  assert.equal(h.view('b:0').lift!.lift, 50, 'still up');
  run(h, 20);
  assert.equal(h.view('b:0').lift!.lift, 50, 'the stay is over now');
  run(h, 100);
  assert.ok(Math.abs(h.view('b:0').lift!.lift - 20) < 1.5, 'the last lifted lowers first');
  assert.equal(h.view('a:0').lift!.lift, 100);
  run(h, 1000);
  assert.equal(h.view('a:0').lift, null);
  assert.equal(h.view('b:0').lift, null);
  assert.equal(h.busy(), false);
});

test('a peek pressed again while laying down resumes from where it was, on any piece of the chain', () => {
  const h = make(chain(), false);
  h.press('a:0', 0, 1);
  h.move(1, 150);
  run(h, 16);
  h.release(1);
  run(h, 400);
  const lowered = h.view('b:0').lift!.lift;
  assert.ok(lowered < 50 && lowered > 0);
  assert.equal(h.press('b:0', 10, 2), 'peeking', 'a covered piece of a chain still up picks it up');
  run(h, 16);
  assert.ok(Math.abs(h.view('b:0').lift!.lift - lowered) < 0.5, 'from where it was');
  h.move(2, 40);
  run(h, 16);
  assert.ok(Math.abs(h.view('b:0').lift!.lift - (lowered + 30)) < 0.5);
});

test('reduced motion: the same stay, then it lays down at once', () => {
  const h = make(chain(), false, { reduced: true });
  h.press('a:0', 0, 1);
  h.move(1, 150);
  run(h, 16);
  h.release(1);
  run(h, 250);
  assert.equal(h.view('b:0').lift!.lift, 50);
  run(h, 100);
  assert.equal(h.view('a:0').lift, null);
});

test('a reader\'s held key lifts one piece\'s width every 0.45 seconds', () => {
  const h = make(chain(), false);
  assert.equal(h.keyDown('a'), true);
  run(h, 450);
  assert.ok(Math.abs(h.view('a:0').lift!.lift - 100) < 4);
  run(h, 450);
  assert.ok(Math.abs(h.view('b:0').lift!.lift - 80) < 4 || h.view('b:0').lift!.lift > 70);
  h.keyUp();
  run(h, 5000);
  assert.equal(h.view('a:0').lift, null);
});

/** A strip that wraps onto two lines, with a lower strip's piece under its first line. */
const wrapped = (under: string[] = []) => [
  piece({ id: 's:0:0', strip: 's:0', index: 0, w: 100, stuck: [[0, 100, 0]], under }),
  piece({ id: 's:0:1', strip: 's:0', index: 1, w: 100, stuck: [[0, 100, 0]] }),
];

test('a reader\'s held key goes on from a wrapped strip\'s first line to its second, and lays both down on letting go', () => {
  const h = make(wrapped(), false);
  assert.equal(h.keyDown('s:0'), true);
  run(h, 450);
  assert.ok(Math.abs(h.view('s:0:0').lift!.lift - 100) < 4, 'the first line is up');
  assert.ok((h.view('s:0:1').lift?.lift ?? 0) < 1, 'the second waits for the first');
  run(h, 450);
  assert.ok(h.view('s:0:1').lift!.lift > 70, `the second line lifts on the same hold (${h.view('s:0:1').lift?.lift})`);
  h.keyUp();
  run(h, 5000);
  assert.equal(h.view('s:0:0').lift, null);
  assert.equal(h.view('s:0:1').lift, null);
});

test('a reader\'s held key lifts what lies under a wrapped strip\'s first line before its second line', () => {
  const h = make([...wrapped(['b:0']), piece({ id: 'b:0', strip: 'b', w: 80, open: false, stuck: [[0, 80, 0]] })], false);
  h.keyDown('s:0');
  run(h, 810);
  assert.ok(h.view('b:0').lift!.lift > 70, 'the strip under the first line is up');
  assert.ok((h.view('s:0:1').lift?.lift ?? 0) < 1, 'the second line waits for it');
  run(h, 450);
  assert.ok(h.view('s:0:1').lift!.lift > 70);
});

test('a reader\'s pointer peek on one line of a wrapped strip lifts only that line', () => {
  const h = make(wrapped(), false);
  h.press('s:0:0', 0, 1);
  h.move(1, 190);
  run(h, 16);
  assert.equal(h.view('s:0:0').lift!.lift, 100);
  assert.equal(h.view('s:0:1').lift, null);
});

test('shares go back through fromPieces: clamped, rounded to four places, and a cut edge kind 0 away from the ends becomes a peel line', () => {
  const h = make([piece({ id: 's:0:0', w: 100, stuck: [[0, 100, 0]] }), piece({ id: 's:0:1', index: 1, w: 100, stuck: [[0, 100, 0]] })]);
  assert.deepEqual(h.sharesOf('s:0'), [[0, 1, 0]]);
  h.sync([piece({ id: 's:0:0', w: 100, stuck: [[33.333333, 100, 3]] }), piece({ id: 's:0:1', index: 1, w: 100, stuck: [[0, 100.0000001, 0]] })]);
  assert.deepEqual(h.sharesOf('s:0'), [[0.1667, 1, 3]]);
});

test('a start that rounds to just under the last stretch\'s end moves up to it; the stretch is dropped only if that leaves nothing', () => {
  const h = make([piece({ id: 's:0:0', w: 100, stuck: [[0, 20.02, 0], [20.0, 100, 0]] }), piece({ id: 's:0:1', index: 1, w: 100, stuck: [] })]);
  assert.deepEqual(h.sharesOf('s:0'), [[0, 0.1001, 1], [0.1001, 0.5, 4]]);
  const gone = make([piece({ id: 's:0:0', w: 100, stuck: [[0, 20.02, 0], [20.0, 20.01, 0]] }), piece({ id: 's:0:1', index: 1, w: 100, stuck: [] })]);
  assert.equal(gone.sharesOf('s:0').length, 1);
});

test('a peel that finishes its piece with the pointer still down lets that hand go: the next press works and the loop is idle', () => {
  const h = make([piece({ w: 60, stuck: [[0, 60, 0]] }), piece({ id: 's:0:1', index: 1, w: 60, stuck: [[0, 60, 0]] })]);
  h.press('s:0:0', 3, 1);
  run(h, 450);
  follow(h, 1200);
  assert.deepEqual(h.view('s:0:0').stuck, []);
  assert.equal(h.busy(), false);
  assert.equal(h.press('s:0:1', 3, 2), 'picking');
});

test('a held pointer with nothing to do lets the loop rest, and a move wakes it: after a tear, and a peek held still', () => {
  const t = make([piece({ w: 400, stuck: [[0, 400, 0]] })]);
  t.press('s:0:0', 3, 1);
  run(t, 450);
  t.move(1, 300);
  run(t, 2500);
  assert.equal(events(t, 'torn').length, 1);
  assert.equal(t.busy(), false, 'torn, hand still down');
  const p = make(chain(), false);
  p.press('a:0', 0, 1);
  p.move(1, 50);
  run(p, 32);
  assert.equal(p.busy(), false, 'held still');
  p.move(1, 60);
  assert.equal(p.busy(), true, 'a move wakes it');
  run(p, 32);
  assert.equal(p.view('a:0').lift!.lift, 60);
});
