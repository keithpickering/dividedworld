import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderInWorld } from '../test-world.tsx';
import { GlassButton } from './Button.tsx';
import { PREPARED_FAILED, usePrepared, useRest } from './prepared.ts';

interface Gate { readonly promise: Promise<string>; readonly resolve: (v: string) => void; readonly reject: (e: unknown) => void }
const gate = (): Gate => {
  let resolve!: (v: string) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<string>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function Trigger({ read }: { readonly read: (s: AbortSignal) => Promise<string> }) {
  const p = usePrepared(read);
  const rest = useRest(p.early);
  return (
    <>
      <GlassButton busy={p.busy} onClick={() => void p.open()} {...rest}>Open it</GlassButton>
      {p.failed && <p>{PREPARED_FAILED}</p>}
      {p.data !== null && <div role="dialog" aria-label="The overlay">{p.data}</div>}
    </>
  );
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

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
});
