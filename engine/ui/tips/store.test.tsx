/** The tips store's notifications (docs/plans/2026-11-02-onboarding-plan.md, Task 4): a withdrawal that changes nothing tells nobody. */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createTipsStore } from './store.ts';

afterEach(() => { document.body.innerHTML = ''; });

describe('withdrawing a request', () => {
  test('one that was dropped already, with nothing queued or showing for it, notifies no one', () => {
    const el = document.createElement('button');
    document.body.append(el);
    const store = createTipsStore({ see: async () => {}, skip: async () => {} });
    store.load({ tips: 'on', seen: [] });
    store.want({ key: 'grid', target: () => el });
    const dropped = store.want({ key: 'ghost', target: () => el });
    const heard = vi.fn();
    store.subscribe(heard);
    dropped();
    expect(heard).not.toHaveBeenCalled();
  });

  test('the showing tip going notifies', () => {
    const el = document.createElement('button');
    document.body.append(el);
    const store = createTipsStore({ see: async () => {}, skip: async () => {} });
    store.load({ tips: 'on', seen: [] });
    const withdraw = store.want({ key: 'grid', target: () => el });
    const heard = vi.fn();
    store.subscribe(heard);
    withdraw();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.active()).toBeNull();
  });
});
