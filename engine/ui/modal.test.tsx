import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Modal } from './modal.tsx';

afterEach(cleanup);

function Host({ onClose = () => {}, fallback }: { readonly onClose?: () => void; readonly fallback?: () => HTMLElement | null }) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <div>
      {!gone && <button type="button" onClick={() => setOpen(true)}>Open it</button>}
      <p id="elsewhere"><a href="#x">Outside link</a></p>
      {open && (
        <Modal title="Turn Pipewrench" onClose={() => { onClose(); setOpen(false); }} returnFocusTo={fallback}>
          <label>Name <input /></label>
          <button type="button">Middle</button>
          <button type="button" onClick={() => setGone(true)}>Remove opener</button>
          <button type="button">Last</button>
        </Modal>
      )}
    </div>
  );
}

const opener = () => screen.getByRole('button', { name: 'Open it' });

describe('the modal', () => {
  test('is a dialog named by its title, and moves focus inside when it opens', async () => {
    render(<Host />);
    await userEvent.click(opener());
    const dialog = screen.getByRole('dialog', { name: 'Turn Pipewrench' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  test('holds Tab and Shift+Tab inside: the last control wraps to the first and back', async () => {
    render(<Host />);
    await userEvent.click(opener());
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  /* A roving grid keeps all its controls but one out of the Tab order (tabindex -1): those are no stops of the dialog's. */
  test('counts only the Tab stops: a control taken out of the Tab order is neither the first nor the last', async () => {
    function Roving() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open it</button>
          {open && (
            <Modal title="React" onClose={() => setOpen(false)}>
              <button type="button" tabIndex={-1}>Out first</button>
              <button type="button">Stop A</button>
              <button type="button">Stop B</button>
              <button type="button" tabIndex={-1}>Out last</button>
            </Modal>
          )}
        </>
      );
    }
    render(<Roving />);
    await userEvent.click(opener());
    expect(screen.getByRole('button', { name: 'Stop A' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Stop B' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Stop B' })).toHaveFocus();
  });

  test('counts a radio group as one stop, at its checked radio, as the browser\'s Tab does: a dialog opened on a choice made focuses that choice', async () => {
    function Chosen() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open it</button>
          {open && (
            <Modal title="Change the Turn" onClose={() => setOpen(false)}>
              <fieldset>
                <legend>Turn to</legend>
                <label><input type="radio" name="to" value="face" /> Face</label>
                <label><input type="radio" name="to" value="lurker" defaultChecked /> Lurker</label>
              </fieldset>
              <fieldset>
                <legend>How loud</legend>
                <label><input type="radio" name="loud" value="silent" /> Silent</label>
                <label><input type="radio" name="loud" value="announced" /> Announced</label>
              </fieldset>
              <button type="button">Last</button>
            </Modal>
          )}
        </>
      );
    }
    render(<Chosen />);
    await userEvent.click(opener());
    expect(screen.getByRole('radio', { name: 'Lurker' })).toHaveFocus();
    // Shift+Tab from the first stop wraps to the last; a group with nothing checked keeps its radios as they were.
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  test('pulls focus back in if it somehow lands outside', async () => {
    render(<Host />);
    await userEvent.click(opener());
    screen.getByRole('link', { name: 'Outside link' }).focus();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  test('closes on Esc and returns focus to the button that opened it', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(opener());
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  test('closes from its Close button, and from a press on the dimmed page', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(opener());
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(opener());
    await userEvent.click(document.querySelector('.kb-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('a press inside the box does not close it', async () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    await userEvent.click(opener());
    await userEvent.click(screen.getByRole('button', { name: 'Middle' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('when the opener is gone by the time it closes, focus goes to the place the screen names', async () => {
    render(<Host fallback={() => document.querySelector<HTMLElement>('#elsewhere a')} />);
    await userEvent.click(opener());
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(opener());
    await userEvent.click(opener());
    // The opener is removed while the dialog is open (a row that changed under it).
    await userEvent.click(screen.getByRole('button', { name: 'Remove opener' }));
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Outside link' }));
  });
});

describe('behind the modal', () => {
  test('a control the closing commit opens and focuses keeps focus: it is not taken back to the opener', async () => {
    /* A play's Lens closes as the spin form it asked for opens, and the form's first field takes focus (the Lens's Spin thread, engine/ui/cards/Lens.tsx). */
    function Handoff() {
      const [open, setOpen] = useState(false);
      const [next, setNext] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open it</button>
          {next && <input aria-label="Next field" ref={(el) => el?.focus()} />}
          {open && (
            <Modal title="Panel" onClose={() => setOpen(false)}>
              <button type="button" onClick={() => { setOpen(false); setNext(true); }}>Go on</button>
            </Modal>
          )}
        </div>
      );
    }
    render(<Handoff />);
    await userEvent.click(opener());
    await userEvent.click(screen.getByRole('button', { name: 'Go on' }));
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Next field')).toHaveFocus();
  });

  test('the page cannot scroll while it is open, and its scrolling is restored exactly on close', async () => {
    document.body.style.overflow = 'scroll';
    document.body.style.paddingRight = '3px';
    render(<Host />);
    await userEvent.click(opener());
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('scroll');
    expect(document.body.style.paddingRight).toBe('3px');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  });

  test('a body that had no overflow set has none again after', async () => {
    render(<Host />);
    await userEvent.click(opener());
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  test('the overlay keeps a scroll inside it from passing to the page', () => {
    expect(readFileSync('engine/ui/modal.css', 'utf8')).toMatch(/\.kb-overlay\s*\{[^}]*overscroll-behavior:\s*contain/u);
  });

  test('the app behind is inert while it is open, and not after', async () => {
    const { container } = render(<Host />);
    await userEvent.click(opener());
    expect(container).toHaveAttribute('inert');
    expect(document.querySelector('.kb-overlay')!.closest('[inert]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(container).not.toHaveAttribute('inert');
  });
});

function Two({ log }: { readonly log: string[] }) {
  const [a, setA] = useState(true);
  const [b, setB] = useState(true);
  return (
    <div>
      {a && (
        <Modal title="First" onClose={() => { log.push('first'); setA(false); }}>
          <button type="button">In first</button>
          {b && (
            <Modal title="Second" onClose={() => { log.push('second'); setB(false); }}>
              <button type="button">In second</button>
            </Modal>
          )}
        </Modal>
      )}
    </div>
  );
}

describe('two modals open', () => {
  test('only the top one answers Esc, then the one under it', async () => {
    const log: string[] = [];
    render(<Two log={log} />);
    await userEvent.keyboard('{Escape}');
    expect(log).toEqual(['second']);
    await userEvent.keyboard('{Escape}');
    expect(log).toEqual(['second', 'first']);
  });

  test('focus stays in the top one, and the page scroll is restored only when both are closed', async () => {
    const log: string[] = [];
    render(<Two log={log} />);
    expect(screen.getByRole('dialog', { name: 'Second' }).contains(document.activeElement)).toBe(true);
    screen.getByRole('button', { name: 'In first' }).focus();
    expect(screen.getByRole('dialog', { name: 'Second' }).contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });
});
