import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { HOLD_PULSE_HELP, HOLD_PULSE_MS, Kit } from './Kit.tsx';
import type { KitControl } from './types.ts';

const draw = (controls: readonly KitControl[]) => renderIn(buildWorld(), <Kit card="whoops" controls={controls} ink="var(--kb-glass-neon)" />);
const hold = (start = vi.fn(), stop = vi.fn()): KitControl => ({ kind: 'hold', label: 'Hold to scrub', describe: 'Hold Space to scrub.', start, stop });

afterEach(() => vi.restoreAllMocks());

describe('hold', () => {
  test('starts on pointer down and stops on pointer up, leave and cancel', () => {
    const start = vi.fn(), stop = vi.fn();
    draw([hold(start, stop)]);
    const b = screen.getByRole('button', { name: 'Hold to scrub' });
    fireEvent.pointerDown(b);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    fireEvent.pointerUp(b);
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(b);
    expect(stop).toHaveBeenCalledTimes(2);
    fireEvent.pointerCancel(b);
    expect(stop).toHaveBeenCalledTimes(3);
  });

  test('Tab and other keys do not start it', () => {
    const start = vi.fn();
    draw([hold(start)]);
    const b = screen.getByRole('button', { name: 'Hold to scrub' });
    fireEvent.keyDown(b, { key: 'Tab' });
    fireEvent.keyDown(b, { key: 'a' });
    expect(start).not.toHaveBeenCalled();
  });

  test('unmounted mid-hold, it stops once; unmounted at rest, it does not', () => {
    const start = vi.fn(), stop = vi.fn();
    const held = draw([hold(start, stop)]);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to scrub' }));
    held.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    const stop2 = vi.fn();
    draw([hold(vi.fn(), stop2)]).unmount();
    expect(stop2).not.toHaveBeenCalled();
  });

  test.each([' ', 'Enter'])('starts on %j keydown and stops on keyup', (key) => {
    const start = vi.fn(), stop = vi.fn();
    draw([hold(start, stop)]);
    const b = screen.getByRole('button', { name: 'Hold to scrub' });
    fireEvent.keyDown(b, { key });
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(b, { key });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("a key's auto-repeat calls start once", () => {
    const start = vi.fn(), stop = vi.fn();
    draw([hold(start, stop)]);
    const b = screen.getByRole('button', { name: 'Hold to scrub' });
    fireEvent.keyDown(b, { key: ' ' });
    fireEvent.keyDown(b, { key: ' ', repeat: true });
    fireEvent.keyDown(b, { key: ' ', repeat: true });
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  test('blur stops, the context menu is swallowed, and describe is its description', () => {
    const stop = vi.fn();
    draw([hold(vi.fn(), stop)]);
    const b = screen.getByRole('button', { name: 'Hold to scrub' });
    fireEvent.blur(b);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fireEvent.contextMenu(b)).toBe(false);
    expect(b).toHaveAccessibleDescription(`Hold Space to scrub. ${HOLD_PULSE_HELP}`);
  });
});

/*
 * A click holds for one second (hot box and fog design, section 4.3). A screen reader in browse mode sends a button a click
 * and never a held key, so without this it could not hold at all; a click is one second, so nothing latches and runs unattended.
 * Fake timers drive the second; each test's poison is named beside it and was run red against the code that carries it.
 */
describe('a click holds for one second', () => {
  const press = (b: HTMLElement) => fireEvent.click(b);

  test('a bare click starts once and stops once, a second later', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      draw([hold(start, stop)]);
      press(screen.getByRole('button', { name: 'Hold to scrub' }));
      expect(start).toHaveBeenCalledTimes(1);
      expect(stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(HOLD_PULSE_MS - 1);
      expect(stop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('a click while a pulse runs only moves its end: no second start, one stop, a second after the last click', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      draw([hold(start, stop)]);
      const b = screen.getByRole('button', { name: 'Hold to scrub' });
      press(b);
      vi.advanceTimersByTime(600);
      press(b);
      expect(start).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(999);
      expect(stop, 'the first click\'s second has passed, the second click\'s has not').not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(stop).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('blur ends a pulse at once, and its timer firing later does not stop it again', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      draw([hold(start, stop)]);
      const b = screen.getByRole('button', { name: 'Hold to scrub' });
      press(b);
      vi.advanceTimersByTime(300);
      fireEvent.blur(b);
      expect(stop).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('a pointer hold owns the control: a click under it changes nothing, and the click after the release is a pulse', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      draw([hold(start, stop)]);
      const b = screen.getByRole('button', { name: 'Hold to scrub' });
      fireEvent.pointerDown(b);
      expect(start).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(500);
      press(b);
      vi.advanceTimersByTime(3000);
      expect(start, 'the click did not start it again').toHaveBeenCalledTimes(1);
      expect(stop, 'the click did not end it, nor set a timer that would').not.toHaveBeenCalled();
      fireEvent.pointerUp(b);
      expect(stop).toHaveBeenCalledTimes(1);
      press(b);
      expect(start).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(HOLD_PULSE_MS);
      expect(stop).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  test('a key hold owns the control the same way', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      draw([hold(start, stop)]);
      const b = screen.getByRole('button', { name: 'Hold to scrub' });
      fireEvent.keyDown(b, { key: ' ' });
      press(b);
      vi.advanceTimersByTime(3000);
      expect(start).toHaveBeenCalledTimes(1);
      expect(stop).not.toHaveBeenCalled();
      fireEvent.keyUp(b, { key: ' ' });
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('unmounted mid-pulse, it stops once and the timer does not stop it again', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      const held = draw([hold(start, stop)]);
      press(screen.getByRole('button', { name: 'Hold to scrub' }));
      held.unmount();
      expect(stop).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('pointer leave during a pulse ends it', () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      draw([hold(vi.fn(), stop)]);
      const b = screen.getByRole('button', { name: 'Hold to scrub' });
      press(b);
      fireEvent.pointerLeave(b);
      expect(stop).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('a pointer press during a pulse takes the hold over: no second start, the pulse timer is cleared, the release ends it', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      draw([hold(start, stop)]);
      const b = screen.getByRole('button', { name: 'Hold to scrub' });
      press(b);
      vi.advanceTimersByTime(500);
      fireEvent.pointerDown(b);
      vi.advanceTimersByTime(3000);
      expect(start).toHaveBeenCalledTimes(1);
      expect(stop, 'the click\'s timer did not end the hold under a held pointer').not.toHaveBeenCalled();
      fireEvent.pointerUp(b);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('a key press during a pulse takes the hold over the same way', () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(), stop = vi.fn();
      draw([hold(start, stop)]);
      const b = screen.getByRole('button', { name: 'Hold to scrub' });
      press(b);
      vi.advanceTimersByTime(500);
      fireEvent.keyDown(b, { key: ' ' });
      vi.advanceTimersByTime(3000);
      expect(start).toHaveBeenCalledTimes(1);
      expect(stop, 'the click\'s timer did not end the hold under a held key').not.toHaveBeenCalled();
      fireEvent.keyUp(b, { key: ' ' });
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  test('the timer stops through the latest control, not the one the click was made on', () => {
    vi.useFakeTimers();
    try {
      const startA = vi.fn(), stopA = vi.fn(), startB = vi.fn(), stopB = vi.fn();
      let swap: (c: KitControl) => void = () => {};
      const Probe = () => {
        const [c, set] = useState<KitControl>(hold(startA, stopA));
        swap = set;
        return <Kit card="whoops" controls={[c]} ink="var(--kb-glass-neon)" />;
      };
      renderIn(buildWorld(), <Probe />);
      press(screen.getByRole('button', { name: 'Hold to scrub' }));
      act(() => swap(hold(startB, stopB)));
      vi.advanceTimersByTime(HOLD_PULSE_MS);
      expect(stopB, 'the new control stopped it').toHaveBeenCalledTimes(1);
      expect(stopA, 'the old control was not called').not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  test('the description is the card\'s words and then the pulse help; a hold with no words has the help alone', () => {
    const held = draw([hold()]);
    expect(screen.getByRole('button', { name: 'Hold to scrub' })).toHaveAccessibleDescription(`Hold Space to scrub. ${HOLD_PULSE_HELP}`);
    held.unmount();
    draw([{ kind: 'hold', label: 'Hold to scrub', start: vi.fn(), stop: vi.fn() }]);
    expect(screen.getByRole('button', { name: 'Hold to scrub' })).toHaveAccessibleDescription(HOLD_PULSE_HELP);
  });
});

describe('the other controls', () => {
  test('press runs', () => {
    const run = vi.fn();
    draw([{ kind: 'press', label: 'Reveal', run }]);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("toggle's aria-pressed follows on and sets the opposite", () => {
    const set = vi.fn();
    draw([{ kind: 'toggle', label: 'Write in ink', on: true, set }]);
    const b = screen.getByRole('button', { name: 'Write in ink' });
    expect(b).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(b);
    expect(set).toHaveBeenCalledWith(false);
  });

  test('a toggle that is off sets true', () => {
    const set = vi.fn();
    draw([{ kind: 'toggle', label: 'Write in ink', on: false, set }]);
    const b = screen.getByRole('button', { name: 'Write in ink' });
    expect(b).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(b);
    expect(set).toHaveBeenCalledWith(true);
  });

  test("the card's ink becomes --kb-tag on the container", () => {
    const { container } = draw([{ kind: 'press', label: 'Reveal', run: vi.fn() }]);
    expect((container.querySelector('.kb-kit') as HTMLElement).style.getPropertyValue('--kb-tag')).toBe('var(--kb-glass-neon)');
  });

  test('no controls draw nothing', () => {
    const { container } = draw([]);
    expect(container.querySelector('.kb-kit')).toBeNull();
  });

  test('choose is a named group; pressing an option reports its value', () => {
    const choose = vi.fn();
    draw([{ kind: 'choose', label: 'Your tool', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Write in ink' }], value: 'wash', choose }]);
    const g = screen.getByRole('group', { name: 'Your tool' });
    expect(g).toContainElement(screen.getByRole('button', { name: 'Wash' }));
    expect(screen.getByRole('button', { name: 'Wash' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Write in ink' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Write in ink' }));
    expect(choose).toHaveBeenCalledWith('ink');
  });

  test('a named kit stands as one row of the hold and the options under one label, which names the group', () => {
    const choose = vi.fn();
    draw([
      { kind: 'hold', label: 'Hold to scrub', start: vi.fn(), stop: vi.fn() },
      { kind: 'choose', label: 'Your tools, as the author', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Write in ink' }], value: 'wash', choose },
    ]);
    const group = screen.getByRole('group', { name: 'Your tools, as the author' });
    expect(group.querySelector('.kb-kit-label')).toHaveTextContent('Your tools, as the author');
    const row = group.querySelector('.kb-kit-row')!;
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Hold to scrub', 'Wash', 'Write in ink']);
  });

  test('go is a link to its address', () => {
    draw([{ kind: 'go', label: 'Open the vending machine', to: '/vending' }]);
    expect(screen.getByRole('link', { name: 'Open the vending machine' })).toHaveAttribute('href', '/vending');
  });
});

describe('how many it draws', () => {
  test('three controls draw two and warn, naming the card', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    draw([
      { kind: 'press', label: 'One', run: vi.fn() }, { kind: 'press', label: 'Two', run: vi.fn() }, { kind: 'press', label: 'Three', run: vi.fn() },
    ]);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['One', 'Two']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('whoops');
  });

  test('two controls draw both and do not warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    draw([{ kind: 'press', label: 'One', run: vi.fn() }, { kind: 'press', label: 'Two', run: vi.fn() }]);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
