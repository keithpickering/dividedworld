import { describe, expect, test, vi } from 'vitest';
import { createMine } from './mine.ts';

describe('the player\'s own reactions store', () => {
  test('holds each kind once, whatever order or how often it is told', () => {
    const m = createMine();
    m.add({ act: 'a', kind: 'fire', character: 'c1' });
    m.add({ act: 'a', kind: 'fire', character: 'c1' });
    m.merge('a', [{ act: 'a', kind: 'tea', character: 'c2' }, { act: 'a', kind: 'fire', character: 'c1' }]);
    expect(m.get('a').map((r) => r.kind).sort()).toEqual(['fire', 'tea']);
    expect(m.get('never')).toEqual([]);
  });

  test('wakes only the post it is for, and only when something is new', () => {
    const m = createMine();
    const a = vi.fn();
    const b = vi.fn();
    m.subscribe('a', a);
    m.subscribe('b', b);
    m.add({ act: 'a', kind: 'fire', character: 'c1' });
    m.add({ act: 'a', kind: 'fire', character: 'c1' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});
