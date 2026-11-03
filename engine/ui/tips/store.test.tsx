/** The tips store's notifications (docs/plans/2026-11-02-onboarding-plan.md, Task 4): a withdrawal that changes nothing tells nobody. */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Modal } from '../modal.tsx';
import { createTipsStore } from './store.ts';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

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

describe('a tip and the modal layer', () => {
  const store = () => {
    const s = createTipsStore({ see: async () => {}, skip: async () => {} });
    s.load({ tips: 'on', seen: [] });
    return s;
  };
  const openModal = () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    render(<Modal title="Picker" onClose={() => {}}><button type="button" id="inside">Grid</button></Modal>);
    return { outside, inside: document.getElementById('inside')! };
  };

  test('a modal that is not the tip\'s own drops it: the target stands outside the top modal', () => {
    const { outside } = openModal();
    const s = store();
    s.want({ key: 'ghost', target: () => outside });
    expect(s.active()).toBeNull();
  });

  test('a tip whose target stands inside the top modal shows over it', () => {
    const { inside } = openModal();
    const s = store();
    s.want({ key: 'grid', target: () => inside });
    expect(s.active()?.key).toBe('grid');
  });

  test('a hold wins over the top modal: a target inside it is dropped while a game effect holds the screen', () => {
    const { inside } = openModal();
    const s = store();
    s.hold('stick-around', true);
    s.want({ key: 'grid', target: () => inside });
    s.hold('stick-around', false);
    expect(s.active()).toBeNull();
  });
});

describe('the callout line: unseen and note', () => {
  const make = (see = vi.fn(async () => {})) => ({ see, store: createTipsStore({ see, skip: async () => {} }) });

  test('unseen is false before load', () => {
    expect(make().store.unseen('first-card')).toBe(false);
  });

  test('note is a no-op with the tips off', () => {
    const { store, see } = make();
    store.load({ tips: 'off', seen: [] });
    store.note('first-card');
    expect(see).not.toHaveBeenCalled();
    expect(store.unseen('first-card')).toBe(false);
  });

  test('note is a no-op when the key is already seen', () => {
    const { store, see } = make();
    store.load({ tips: 'on', seen: ['first-card'] });
    store.note('first-card');
    expect(see).not.toHaveBeenCalled();
    expect(store.unseen('first-card')).toBe(false);
  });

  test('the account is told once across two notes', () => {
    const { store, see } = make();
    store.load({ tips: 'on', seen: [] });
    store.note('first-card');
    store.note('first-card');
    expect(see).toHaveBeenCalledTimes(1);
    expect(see).toHaveBeenCalledWith('first-card');
  });

  test('a rejected see is swallowed', async () => {
    const { store } = make(vi.fn(async () => { throw new Error('offline'); }));
    store.load({ tips: 'on', seen: [] });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    expect(() => store.note('first-card')).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test('a callout that moves to another mark keeps the line until Got it; a later load does not show it', () => {
    const { store } = make();
    store.load({ tips: 'on', seen: [] });
    expect(store.unseen('first-card')).toBe(true);
    store.note('first-card');
    expect(store.unseen('first-card'), 'the bubble that mounts next, on another mark, still carries it').toBe(true);
    store.done('first-card');
    expect(store.unseen('first-card'), 'after Got it, the next callout does not').toBe(false);
    const later = make().store;
    later.load({ tips: 'on', seen: ['first-card'] });
    expect(later.unseen('first-card')).toBe(false);
  });
});
