import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderInWorld } from '../test-world.tsx';
import { GlassButton } from './Button.tsx';
import { readAhead, resetReadAhead } from '../ahead.ts';
import { PREPARED_FAILED, usePrepared, useRest } from './prepared.ts';

interface Gate { readonly promise: Promise<string>; readonly resolve: (v: string) => void; readonly reject: (e: unknown) => void }
const gate = (): Gate => {
  let resolve!: (v: string) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<string>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function Trigger({ read, label = 'Open it' }: { readonly read: (s: AbortSignal) => Promise<string>; readonly label?: string }) {
  const p = usePrepared(read);
  const rest = useRest(p.early);
  return (
    <>
      <GlassButton busy={p.busy} onClick={() => void p.open()} {...rest}>{label}</GlassButton>
      {p.failed && <p>{PREPARED_FAILED}</p>}
      {p.data !== null && <div role="dialog" aria-label="The overlay">{p.data}</div>}
    </>
  );
}

afterEach(() => { cleanup(); vi.useRealTimers(); resetReadAhead(); });

describe('usePrepared', () => {
  test('early, then open, makes one read and opens at once', async () => {
    const read = vi.fn(() => Promise.resolve('whole'));
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.pointerEnter(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(read).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('dialog', { name: 'The overlay' })).toHaveTextContent('whole');
    expect(read).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveAttribute('aria-busy');
  });

  test('a rest shorter than 100 ms reads nothing', async () => {
    const read = vi.fn(() => Promise.resolve('whole'));
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.pointerEnter(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.pointerLeave(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(read).not.toHaveBeenCalled();
  });

  test('open alone is busy until the read lands, then opens', async () => {
    const g = gate();
    const read = vi.fn(() => g.promise);
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(screen.getByRole('button', { name: 'Open it' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { g.resolve('whole'); await g.promise; });
    expect(await screen.findByRole('dialog', { name: 'The overlay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open it' })).not.toHaveAttribute('aria-busy');
  });

  test('Escape cancels: the signal is aborted and nothing opens', async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    renderInWorld(<Trigger read={(s) => { signal = s; return g.promise; }} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await userEvent.keyboard('{Escape}');
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Open it' })).not.toHaveAttribute('aria-busy');
    await act(async () => { g.resolve('late'); await g.promise; });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a failure shows the plain line, and the next press clears it', async () => {
    const g = gate();
    const second = gate();
    const reads = [g, second];
    const read = vi.fn(() => reads.shift()!.promise);
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await act(async () => { g.reject(new Error('down')); await g.promise.catch(() => undefined); });
    expect(await screen.findByText('That didn’t load. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open it' })).not.toHaveAttribute('aria-busy');
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(screen.queryByText('That didn’t load. Try again.')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('Escape while busy is consumed: no other Escape listener sees it', async () => {
    const g = gate();
    renderInWorld(<Trigger read={() => g.promise} />, { path: '/characters' });
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await userEvent.keyboard('{Escape}');
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener('keydown', seen);
    expect(screen.getByRole('button', { name: 'Open it' })).not.toHaveAttribute('aria-busy');
  });

  test('an answer read early is kept 30 seconds and read again after', async () => {
    const read = vi.fn(() => Promise.resolve('whole'));
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.pointerEnter(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('the keep never aborts a read that is still out: an open that adopted it lands', async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    renderInWorld(<Trigger read={(s) => { signal = s; return g.promise; }} />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.pointerEnter(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(signal?.aborted).toBe(false);
    await act(async () => { g.resolve('slow'); await g.promise; });
    expect(screen.getByRole('dialog', { name: 'The overlay' })).toHaveTextContent('slow');
  });

  test('a read for A that lands after B was asked opens nothing of A', async () => {
    const a = gate();
    const b = gate();
    function Two() {
      const p = usePrepared<string, string>((_s, which) => (which === 'A' ? a.promise : b.promise), (which) => which);
      return (
        <>
          <button type="button" onClick={() => void p.open('A')}>A</button>
          <button type="button" onClick={() => void p.open('B')}>B</button>
          {p.data !== null && <div role="dialog">{p.data}</div>}
        </>
      );
    }
    renderInWorld(<Two />, { path: '/characters' });
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    await act(async () => { a.resolve('from A'); await a.promise; });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { b.resolve('from B'); await b.promise; });
    expect(screen.getByRole('dialog')).toHaveTextContent('from B');
  });

  test('under StrictMode an early then an open still make one read and open', async () => {
    const read = vi.fn(() => Promise.resolve('whole'));
    renderInWorld(<StrictMode><Trigger read={read} /></StrictMode>, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.pointerEnter(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('dialog', { name: 'The overlay' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('a press drops the pending rest timer: the press starts the read itself, and no second one follows', async () => {
    const read = vi.fn(() => Promise.reject(new Error('down')));
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.pointerEnter(button);
    fireEvent.focus(button);
    fireEvent.pointerDown(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(read).not.toHaveBeenCalled();
  });

  test('a key press (Enter or Space) drops the pending rest timers too', async () => {
    const read = vi.fn(() => Promise.resolve('whole'));
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.focus(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(read).not.toHaveBeenCalled();
    fireEvent.focus(button);
    fireEvent.keyDown(button, { key: ' ' });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(read).not.toHaveBeenCalled();
  });

  test('a mouse press focuses the trigger after pointer down: that focus arms no rest timer either', async () => {
    const read = vi.fn(() => Promise.reject(new Error('down')));
    renderInWorld(<Trigger read={read} />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Open it' });
    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(read).not.toHaveBeenCalled();
    fireEvent.blur(button);
    fireEvent.focus(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('usePrepared reads ahead through the shared gate', () => {
  const rest = async (button: HTMLElement) => {
    fireEvent.pointerEnter(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  };
  const two = (a: () => Promise<string>, b: () => Promise<string>) => {
    renderInWorld(<><Trigger read={a} label="First" /><Trigger read={b} label="Second" /></>, { path: '/characters' });
    vi.useFakeTimers();
    return { first: screen.getByRole('button', { name: 'First' }), second: screen.getByRole('button', { name: 'Second' }) };
  };

  test('a second trigger rested on while the first read is out waits, and starts when the first lands', async () => {
    const g = gate();
    const a = vi.fn(() => g.promise);
    const b = vi.fn(() => Promise.resolve('b'));
    const { first, second } = two(a, b);
    await rest(first);
    await rest(second);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('leaving the waiting trigger before the first lands means it never reads', async () => {
    const g = gate();
    const b = vi.fn(() => Promise.resolve('b'));
    const { first, second } = two(() => g.promise, b);
    await rest(first);
    await rest(second);
    fireEvent.pointerLeave(second);
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).not.toHaveBeenCalled();
  });

  test('blurring the waiting trigger gives up its place too', async () => {
    const g = gate();
    const b = vi.fn(() => Promise.resolve('b'));
    const { first, second } = two(() => g.promise, b);
    await rest(first);
    fireEvent.focus(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    fireEvent.blur(second);
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).not.toHaveBeenCalled();
  });

  test('a press on the waiting trigger gives up its place, and open reads at once', async () => {
    const g = gate();
    const b = vi.fn(() => Promise.resolve('b'));
    const { first, second } = two(() => g.promise, b);
    await rest(first);
    await rest(second);
    expect(b).not.toHaveBeenCalled();
    fireEvent.pointerDown(second);
    fireEvent.click(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(b).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'The overlay' })).toHaveTextContent('b');
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('a link’s read ahead in flight makes a card trigger’s rest wait, and it starts when the link’s lands', async () => {
    const link = gate();
    readAhead(() => link.promise);
    const b = vi.fn(() => Promise.resolve('b'));
    renderInWorld(<Trigger read={b} label="Card" />, { path: '/characters' });
    vi.useFakeTimers();
    await rest(screen.getByRole('button', { name: 'Card' }));
    expect(b).not.toHaveBeenCalled();
    await act(async () => { link.resolve('x'); await link.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('a card trigger’s read ahead in flight makes a link’s read wait', async () => {
    const g = gate();
    renderInWorld(<Trigger read={() => g.promise} label="Card" />, { path: '/characters' });
    vi.useFakeTimers();
    await rest(screen.getByRole('button', { name: 'Card' }));
    const linkStart = vi.fn(() => Promise.resolve('link'));
    readAhead(linkStart);
    expect(linkStart).not.toHaveBeenCalled();
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(linkStart).toHaveBeenCalledTimes(1);
  });

  test('a trigger whose answer is held does not take the gate for a second rest', async () => {
    const a = vi.fn(() => Promise.resolve('a'));
    renderInWorld(<Trigger read={a} label="Card" />, { path: '/characters' });
    vi.useFakeTimers();
    const button = screen.getByRole('button', { name: 'Card' });
    await rest(button);
    expect(a).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(button);
    const out = gate();
    readAhead(() => out.promise);
    const waiting = vi.fn(() => Promise.resolve('w'));
    readAhead(waiting);
    await rest(button);
    expect(a).toHaveBeenCalledTimes(1);
    await act(async () => { out.resolve('x'); await out.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(waiting).toHaveBeenCalledTimes(1);
  });

  test('the pointer leaving a waiting trigger the focus still rests on keeps its place, and the reverse', async () => {
    for (const leave of ['pointer', 'focus'] as const) {
      cleanup(); resetReadAhead(); vi.useRealTimers();
      const g = gate();
      const b = vi.fn(() => Promise.resolve('b'));
      const { first, second } = two(() => g.promise, b);
      await rest(first);
      fireEvent.pointerEnter(second);
      fireEvent.focus(second);
      await act(async () => { await vi.advanceTimersByTimeAsync(120); });
      if (leave === 'pointer') fireEvent.pointerLeave(second); else fireEvent.blur(second);
      await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
      expect(b).toHaveBeenCalledTimes(1);
    }
  });

  test('both the pointer and the focus leaving a waiting trigger means it never reads', async () => {
    const g = gate();
    const b = vi.fn(() => Promise.resolve('b'));
    const { first, second } = two(() => g.promise, b);
    await rest(first);
    fireEvent.pointerEnter(second);
    fireEvent.focus(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    fireEvent.pointerLeave(second);
    fireEvent.blur(second);
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).not.toHaveBeenCalled();
  });

  test('a later rest that asks for nothing does not lose the withdraw of the read still waiting', async () => {
    const g = gate();
    const b = vi.fn(() => Promise.resolve('b'));
    let guard = false;
    function Guarded() {
      const p = usePrepared(() => b());
      const r = useRest(() => (guard ? undefined : p.early()));
      return <button type="button" {...r}>Guarded</button>;
    }
    renderInWorld(<><Trigger read={() => g.promise} label="First" /><Guarded /></>, { path: '/characters' });
    vi.useFakeTimers();
    await rest(screen.getByRole('button', { name: 'First' }));
    const button = screen.getByRole('button', { name: 'Guarded' });
    await rest(button);
    guard = true;
    fireEvent.focus(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    fireEvent.pointerDown(button);
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).not.toHaveBeenCalled();
  });

  test('a trigger unmounted while its read waits never reads', async () => {
    const g = gate();
    const b = vi.fn(() => Promise.resolve('b'));
    function Hider() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>Hide</button>
          {shown && <Trigger read={b} label="Second" />}
        </>
      );
    }
    renderInWorld(<><Trigger read={() => g.promise} label="First" /><Hider /></>, { path: '/characters' });
    vi.useFakeTimers();
    await rest(screen.getByRole('button', { name: 'First' }));
    await rest(screen.getByRole('button', { name: 'Second' }));
    expect(b).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { g.resolve('a'); await g.promise; await vi.advanceTimersByTimeAsync(0); });
    expect(b).not.toHaveBeenCalled();
  });
});
