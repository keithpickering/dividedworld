/**
 * What the Lens reads once for a spring (once.ts): kept per api and spring, an unreadable answer asked again, a failure not kept.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { onceFor } from './once.ts';

describe('onceFor', () => {
  test('an answer is read once for an api and a spring, each kind apart', async () => {
    const api = {};
    let reads = 0;
    const read = async () => { reads += 1; return 'x'; };
    assert.equal(await onceFor(api, 'sp', 'words', read), 'x');
    assert.equal(await onceFor(api, 'sp', 'words', read), 'x');
    assert.equal(reads, 1);
    await onceFor(api, 'sp', 'fate', read);
    await onceFor({}, 'sp', 'words', read);
    assert.equal(reads, 3);
  });
  test('a null answer is not kept, so it is asked again', async () => {
    const api = {};
    let reads = 0;
    const read = async () => { reads += 1; return reads < 2 ? null : 'later'; };
    assert.equal(await onceFor(api, 'sp', 'fate', read), null);
    assert.equal(await onceFor(api, 'sp', 'fate', read), 'later');
    assert.equal(reads, 2);
  });
  test('a failed read is not kept either', async () => {
    const api = {};
    let reads = 0;
    const read = async () => { reads += 1; if (reads === 1) throw new Error('down'); return 'ok'; };
    await assert.rejects(onceFor(api, 'sp', 'words', read));
    assert.equal(await onceFor(api, 'sp', 'words', read), 'ok');
  });
});
