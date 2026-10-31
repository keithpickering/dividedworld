import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Kit } from './Kit.tsx';
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
    expect(b).toHaveAccessibleDescription('Hold Space to scrub.');
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
