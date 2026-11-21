import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { CAPTIONS_SHOWN, createCaptions, QUIET_MS, SAID_MS } from './captions.ts';

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'] }); });
afterEach(() => { mock.timers.reset(); });

type Store = ReturnType<typeof createCaptions>;
const lines = (c: Store) => c.lines() ?? [];
const anns = (c: Store) => c.announcements() ?? [];
const texts = (c: Store) => lines(c).map((l) => l.text);
const shape = (c: Store) => lines(c).map((l) => `${l.text}${l.held ? ' (held)' : ''} x${l.count}`);

describe('the caption store', () => {
  test('shows nothing until something is said', () => {
    const c = createCaptions();
    assert.deepEqual(lines(c), []);
    assert.deepEqual(anns(c), []);
  });

  test('the constants are the design\'s', () => {
    assert.deepEqual([CAPTIONS_SHOWN, QUIET_MS, SAID_MS], [3, 700, 2500]);
  });

  test('one say shows one line, count 1, not held; the same words and ink said again make count 2 on the same id', () => {
    const c = createCaptions();
    c.say({ text: 'Laughter', ink: 'var(--kb-glass-salty)', ms: 2500 });
    assert.equal(lines(c).length, 1);
    const first = lines(c)[0];
    assert.deepEqual({ text: first.text, ink: first.ink, held: first.held, count: first.count }, { text: 'Laughter', ink: 'var(--kb-glass-salty)', held: false, count: 1 });
    c.say({ text: 'Laughter', ink: 'var(--kb-glass-salty)', ms: 2500 });
    assert.equal(lines(c).length, 1);
    assert.equal(lines(c)[0].count, 2);
    assert.equal(lines(c)[0].id, first.id);
  });

  test('ink absent on both says counts as equal', () => {
    const c = createCaptions();
    c.say({ text: 'Boo', ms: 1000 });
    c.say({ text: 'Boo', ms: 1000 });
    assert.deepEqual(shape(c), ['Boo x2']);
  });

  test('the same text with another ink gives two lines', () => {
    const c = createCaptions();
    c.say({ text: 'Boo', ink: 'red', ms: 1000 });
    c.say({ text: 'Boo', ink: 'blue', ms: 1000 });
    assert.deepEqual(shape(c), ['Boo x1', 'Boo x1']);
  });

  test('a say goes after its ms', () => {
    const c = createCaptions();
    c.say({ text: 'First', ms: 1000 });
    mock.timers.tick(999);
    assert.deepEqual(texts(c), ['First']);
    mock.timers.tick(1);
    assert.deepEqual(texts(c), []);
  });

  test('a repeat that ends sooner leaves the line\'s end as it was', () => {
    const c = createCaptions();
    c.say({ text: 'A', ms: 1000 });
    mock.timers.tick(500);
    c.say({ text: 'A', ms: 200 });
    mock.timers.tick(499);
    assert.deepEqual(texts(c), ['A']);
    mock.timers.tick(1);
    assert.deepEqual(texts(c), []);
  });

  test('a repeat that ends later moves the end, and the old timer does not clear the line', () => {
    const c = createCaptions();
    c.say({ text: 'A', ms: 1000 });
    mock.timers.tick(500);
    c.say({ text: 'A', ms: 900 });
    mock.timers.tick(899);
    assert.deepEqual(texts(c), ['A']);
    mock.timers.tick(1);
    assert.deepEqual(texts(c), []);
  });

  test('order is when each first showed; a repeat does not move a line', () => {
    const c = createCaptions();
    c.say({ text: 'A', ms: 5000 });
    c.say({ text: 'B', ms: 5000 });
    c.say({ text: 'A', ms: 5000 });
    assert.deepEqual(shape(c), ['A x2', 'B x1']);
  });

  test('four different says leave the last three', () => {
    const c = createCaptions();
    for (const t of ['A', 'B', 'C', 'D']) c.say({ text: t, ms: 5000 });
    assert.deepEqual(texts(c), ['B', 'C', 'D']);
  });

  test('a pushed-out line\'s timer is gone: a later line of the same words is a fresh line', () => {
    const c = createCaptions();
    for (const t of ['A', 'B', 'C', 'D']) c.say({ text: t, ms: 1000 });
    c.say({ text: 'A', ms: 5000 });
    mock.timers.tick(1000);
    assert.deepEqual(shape(c), ['A x1']);
  });

  test('a hold counts toward the three and is never pushed out', () => {
    const c = createCaptions();
    c.hold('h', { text: 'H' });
    for (const t of ['A', 'B', 'C']) c.say({ text: t, ms: 5000 });
    assert.deepEqual(shape(c), ['H (held) x1', 'B x1', 'C x1']);
  });

  test('three holds and then a say show four lines', () => {
    const c = createCaptions();
    c.hold('1', { text: 'H1' });
    c.hold('2', { text: 'H2' });
    c.hold('3', { text: 'H3' });
    c.say({ text: 'A', ms: 5000 });
    assert.deepEqual(texts(c), ['H1', 'H2', 'H3', 'A']);
  });

  test('a hold shows until its release, and a release takes its own line away', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Building' });
    assert.deepEqual(shape(c), ['Building (held) x1']);
    c.hold('b', { text: 'Building more' });
    assert.deepEqual(texts(c), ['Building', 'Building more']);
    c.release('b');
    assert.deepEqual(texts(c), ['Building']);
    c.release('a');
    assert.deepEqual(texts(c), []);
  });

  test('a hold sits beside a say and stays after it ends', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Building' });
    c.say({ text: 'Boom', ms: 500 });
    assert.deepEqual(texts(c), ['Building', 'Boom']);
    mock.timers.tick(500);
    assert.deepEqual(shape(c), ['Building (held) x1']);
  });

  test('a hold released while a say shows leaves the say, which still goes at its end', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Building' });
    c.say({ text: 'Boom', ms: 500 });
    c.release('a');
    assert.deepEqual(texts(c), ['Boom']);
    mock.timers.tick(500);
    assert.deepEqual(lines(c), []);
  });

  test('two hold ids with the same words make one held line; it goes when both are released', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Loop' });
    c.hold('b', { text: 'Loop' });
    assert.deepEqual(shape(c), ['Loop (held) x1']);
    c.release('a');
    assert.deepEqual(texts(c), ['Loop']);
    c.release('b');
    assert.deepEqual(texts(c), []);
  });

  test('a hold re-said with new words moves; the old line goes if no other id holds it', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Old' });
    c.hold('b', { text: 'Old' });
    c.hold('a', { text: 'New' });
    assert.deepEqual(texts(c), ['Old', 'New']);
    c.hold('b', { text: 'New' });
    assert.deepEqual(texts(c), ['New']);
  });

  test('lines() is the same array between calls, and after a hold re-said with the same words, which tells no one', () => {
    const c = createCaptions();
    let heard = 0;
    c.hold('a', { text: 'Loop', ink: 'red' });
    c.say({ text: 'A', ms: 5000 });
    c.subscribe(() => { heard += 1; });
    const before = c.lines();
    assert.ok(before);
    assert.equal(c.lines(), before);
    c.hold('a', { text: 'Loop', ink: 'red' });
    assert.equal(c.lines(), before);
    assert.equal(heard, 0);
    c.say({ text: 'B', ms: 5000 });
    assert.notEqual(c.lines(), before);
    assert.equal(heard, 1);
  });

  test('announcements() is the same array until something is announced or leaves', () => {
    const c = createCaptions();
    c.say({ text: 'A', ms: 5000 });
    const before = c.announcements();
    assert.ok(before);
    assert.equal(c.announcements(), before);
    mock.timers.tick(SAID_MS);
    assert.notEqual(c.announcements(), before);
  });

  test('subscribers hear each change, and stop when they unsubscribe', () => {
    const c = createCaptions();
    let heard = 0;
    const off = c.subscribe(() => { heard += 1; });
    c.say({ text: 'x', ms: 100 });
    assert.equal(heard, 1);
    mock.timers.tick(100);
    assert.equal(heard, 2);
    off();
    c.say({ text: 'y', ms: 100 });
    assert.equal(heard, 2);
  });

  test('releasing a hold that is not there changes nothing and tells no one', () => {
    const c = createCaptions();
    let heard = 0;
    c.subscribe(() => { heard += 1; });
    c.release('nope');
    assert.equal(heard, 0);
  });

  describe('announcements', () => {
    test('a first say pushes its text', () => {
      const c = createCaptions();
      c.say({ text: 'Laughter', ms: 5000 });
      assert.deepEqual(anns(c).map((a) => a.text), ['Laughter']);
    });

    test('three repeats within QUIET_MS of each other push one "4 times" QUIET_MS after the last', () => {
      const c = createCaptions();
      c.say({ text: 'Boo', ms: 5000 });
      for (let i = 0; i < 3; i++) {
        mock.timers.tick(300);
        c.say({ text: 'Boo', ms: 5000 });
      }
      assert.deepEqual(anns(c).map((a) => a.text), ['Boo']);
      mock.timers.tick(QUIET_MS - 1);
      assert.deepEqual(anns(c).map((a) => a.text), ['Boo']);
      mock.timers.tick(1);
      assert.deepEqual(anns(c).map((a) => a.text), ['Boo', 'Boo, 4 times']);
    });

    test('a line that ends before its quiet timer fires pushes its total at the end', () => {
      const c = createCaptions();
      c.say({ text: 'Boo', ms: 300 });
      c.say({ text: 'Boo', ms: 300 });
      mock.timers.tick(300);
      assert.deepEqual(texts(c), []);
      assert.deepEqual(anns(c).map((a) => a.text), ['Boo', 'Boo, 2 times']);
      mock.timers.tick(QUIET_MS);
      assert.equal(anns(c).filter((a) => a.text === 'Boo, 2 times').length, 1);
    });

    test('a line pushed out by a newer one pushes its total as it leaves', () => {
      const c = createCaptions();
      c.say({ text: 'A', ms: 5000 });
      c.say({ text: 'A', ms: 5000 });
      for (const t of ['B', 'C', 'D']) c.say({ text: t, ms: 5000 });
      assert.deepEqual(texts(c), ['B', 'C', 'D']);
      assert.ok(anns(c).some((a) => a.text === 'A, 2 times'));
    });

    test('a line said once pushes nothing more when it ends', () => {
      const c = createCaptions();
      c.say({ text: 'Once', ms: 300 });
      mock.timers.tick(300);
      assert.deepEqual(anns(c).map((a) => a.text), ['Once']);
      mock.timers.tick(QUIET_MS);
      assert.deepEqual(anns(c).map((a) => a.text), ['Once']);
    });

    test('a hold pushes nothing', () => {
      const c = createCaptions();
      c.hold('a', { text: 'Loop' });
      c.release('a');
      assert.deepEqual(anns(c), []);
    });

    test('each announcement is gone SAID_MS after it was pushed, and every seq differs', () => {
      const c = createCaptions();
      c.say({ text: 'Boo', ms: 5000 });
      mock.timers.tick(1000);
      c.say({ text: 'Boo', ms: 5000 });
      mock.timers.tick(QUIET_MS);
      assert.equal(anns(c).length, 2);
      assert.equal(new Set(anns(c).map((a) => a.seq)).size, 2);
      mock.timers.tick(SAID_MS - QUIET_MS);
      assert.deepEqual(anns(c).map((a) => a.text), ['Boo, 2 times']);
      mock.timers.tick(QUIET_MS);
      assert.deepEqual(anns(c), []);
    });
  });

  test('reset empties both lists, announces nothing, and no timer fires after it', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Building' });
    c.say({ text: 'Boom', ms: 500 });
    c.say({ text: 'Boom', ms: 500 });
    let heard = 0;
    c.subscribe(() => { heard += 1; });
    c.reset();
    assert.deepEqual(lines(c), []);
    assert.deepEqual(anns(c), []);
    assert.equal(heard, 1);
    mock.timers.tick(60000);
    assert.equal(heard, 1);
    assert.deepEqual(anns(c), []);
    c.say({ text: 'Next', ms: 1000 });
    c.release('a');
    assert.deepEqual(texts(c), ['Next']);
  });
});
