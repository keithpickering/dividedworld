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

  describe('pending reactions', () => {
    const p = { act: 'a', kind: 'fire', character: 'c1', due: 1000 };

    test('a held reaction is listed as pending and not as sent', () => {
      const m = createMine();
      expect(m.hold(p)).toBe(true);
      expect(m.pending('a')).toEqual([p]);
      expect(m.get('a')).toEqual([]);
      expect(m.pending('a')).toBe(m.pending('a'));
      expect(m.pending('never')).toBe(m.pending('never'));
    });

    test('a kind already sent or already held is refused', () => {
      const m = createMine();
      m.add({ act: 'a', kind: 'tea', character: 'c1' });
      expect(m.hold({ ...p, kind: 'tea' })).toBe(false);
      expect(m.hold(p)).toBe(true);
      expect(m.hold({ ...p, character: 'c2' })).toBe(false);
      expect(m.pending('a')).toEqual([p]);
    });

    test('release returns the entry and empties pending; nothing returns null', () => {
      const m = createMine();
      m.hold(p);
      expect(m.release('a', 'fire')).toEqual(p);
      expect(m.pending('a')).toEqual([]);
      expect(m.release('a', 'fire')).toBeNull();
    });

    test('adding a held kind moves it from pending to sent', () => {
      const m = createMine();
      const l = vi.fn();
      m.hold(p);
      m.subscribe('a', l);
      m.add({ act: 'a', kind: 'fire', character: 'c1' });
      expect(m.pending('a')).toEqual([]);
      expect(m.get('a').map((r) => r.kind)).toEqual(['fire']);
      expect(l).toHaveBeenCalled();
    });

    test('merging a held kind also clears it from pending', () => {
      const m = createMine();
      m.hold(p);
      m.merge('a', [{ act: 'a', kind: 'fire', character: 'c1' }]);
      expect(m.pending('a')).toEqual([]);
    });

    test('hold and release wake only their own Act', () => {
      const m = createMine();
      const a = vi.fn();
      const b = vi.fn();
      m.subscribe('a', a);
      m.subscribe('b', b);
      m.hold(p);
      m.release('a', 'fire');
      expect(a).toHaveBeenCalledTimes(2);
      expect(b).not.toHaveBeenCalled();
    });
  });
});
