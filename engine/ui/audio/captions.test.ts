import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { createCaptions } from './captions.ts';

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { mock.timers.reset(); });

describe('the caption store', () => {
  test('shows nothing until something is said', () => {
    const c = createCaptions();
    assert.equal(c.current(), null);
  });

  test('a say shows its words and ink, and a later say replaces it', () => {
    const c = createCaptions();
    c.say({ text: 'Laughter', ink: 'var(--kb-glass-salty)', ms: 2500 });
    assert.deepEqual({ text: c.current()?.text, ink: c.current()?.ink, held: c.current()?.held }, { text: 'Laughter', ink: 'var(--kb-glass-salty)', held: false });
    c.say({ text: 'Cheering', ms: 2500 });
    assert.equal(c.current()?.text, 'Cheering');
    assert.equal(c.current()?.ink, undefined);
  });

  test('a say goes after its ms, and a replaced say\'s old timer does not clear the new one', () => {
    const c = createCaptions();
    c.say({ text: 'First', ms: 1000 });
    mock.timers.tick(600);
    c.say({ text: 'Second', ms: 1000 });
    mock.timers.tick(600);
    assert.equal(c.current()?.text, 'Second');
    mock.timers.tick(400);
    assert.equal(c.current(), null);
  });

  test('a hold shows while nothing is said, the latest hold wins, and a release takes its own away', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Building' });
    assert.equal(c.current()?.held, true);
    c.hold('b', { text: 'Building more' });
    assert.equal(c.current()?.text, 'Building more');
    c.release('b');
    assert.equal(c.current()?.text, 'Building');
    c.release('a');
    assert.equal(c.current(), null);
  });

  test('a hold sits under a say and is back after it', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Building' });
    c.say({ text: 'Boom', ms: 500 });
    assert.equal(c.current()?.text, 'Boom');
    assert.equal(c.current()?.held, false);
    mock.timers.tick(500);
    assert.equal(c.current()?.text, 'Building');
    assert.equal(c.current()?.held, true);
  });

  test('a hold released while a say shows does not come back', () => {
    const c = createCaptions();
    c.hold('a', { text: 'Building' });
    c.say({ text: 'Boom', ms: 500 });
    c.release('a');
    assert.equal(c.current()?.text, 'Boom');
    mock.timers.tick(500);
    assert.equal(c.current(), null);
  });

  test('subscribers hear each change, and stop when they unsubscribe', () => {
    const c = createCaptions();
    let heard = 0;
    const off = c.subscribe(() => { heard += 1; });
    c.say({ text: 'x', ms: 100 });
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
});
