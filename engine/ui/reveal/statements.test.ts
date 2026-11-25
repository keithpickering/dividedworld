import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SeasonShown } from '../data/api.ts';
import { finalClass } from './statements.ts';

const reveal = (at: string, cls: string): SeasonShown => ({ kind: 'reveal', act: `r-${at}`, at, class: cls, was: null });
const turn = (at: string, cls: string | null = null): SeasonShown => ({ kind: 'turn', act: `t-${at}`, at, class: cls, was: null });

describe('finalClass', () => {
  test('is the last reveal when the list ends on one', () => {
    assert.deepEqual(finalClass([reveal('2026-10-03T12:00:00Z', 'heel'), reveal('2026-10-05T12:00:00Z', 'face')]), { cls: 'face', at: '2026-10-05T12:00:00Z' });
  });

  test('is null where a Turn follows the last reveal', () => {
    assert.equal(finalClass([reveal('2026-10-03T12:00:00Z', 'heel'), turn('2026-10-09T12:00:00Z')]), null);
  });

  test('is the reveal of a Turn announced with its new class, which sorts after its Turn at one instant', () => {
    const at = '2026-10-09T12:00:00Z';
    assert.deepEqual(finalClass([reveal('2026-10-03T12:00:00Z', 'heel'), turn(at, 'heel'), reveal(at, 'face')]), { cls: 'face', at });
  });

  test('is null where nothing was revealed', () => {
    assert.equal(finalClass([]), null);
    assert.equal(finalClass([turn('2026-10-09T12:00:00Z')]), null);
  });
});
