/**
 * Graffiti's toolbar (plan Task 10; design sections 8, 9 and 11): the glass's dock with its two tabs, the meter, the fourteen cans, the caps, Undo,
 * the stencils and the spots, Cancel and Tag it. It is a view of what DrawMode keeps, so every test here gives it the state and reads what it
 * says and calls: the controls are reachable by Tab and named, the cans and the caps are radiogroups with arrow keys, and Tag it says why it is
 * not ready.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { CANS, type Can, type Cap } from '../graffiti.ts';
import { STENCIL_KEYS, type StencilKey } from './stencils.ts';
import { dockHostOf, Toolbar, type ToolbarProps } from './Toolbar.tsx';

const EMPTY = { wall: 3100, after: 3100, most: 4000, over: false };

function propsOf(over: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    can: 'cyan', onCan: vi.fn(), cap: 'stock', onCap: vi.fn(), tab: 'spray', onTab: vi.fn(), stencil: null, onStencil: vi.fn(), spot: 4, onSpot: vi.fn(),
    meter: EMPTY, hasDraft: false, canUndo: false, onUndo: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn(), busy: false, refusal: null, notice: null,
    asking: null, onLeave: vi.fn(), onStay: vi.fn(), ...over,
  };
}

/** The toolbar with its choices kept, as DrawMode keeps them. */
function Kept(props: Partial<ToolbarProps> & { readonly spy?: Partial<ToolbarProps> }) {
  const [can, setCan] = useState<Can>('cyan');
  const [cap, setCap] = useState<Cap>('stock');
  const [tab, setTab] = useState<'spray' | 'stencils'>('spray');
  const [stencil, setStencil] = useState<StencilKey | null>(null);
  const [spot, setSpot] = useState(4);
  return <Toolbar {...propsOf({ ...props, can, onCan: setCan, cap, onCap: setCap, tab, onTab: setTab, stencil, onStencil: setStencil, spot, onSpot: setSpot })} />;
}

const CAN_NAMES = Object.keys(CANS).map((k) => k[0]!.toUpperCase() + k.slice(1));
const focusedName = () => {
  const el = document.activeElement as HTMLElement;
  return el.getAttribute('aria-label') ?? el.textContent;
};

describe('every control is reachable by Tab and named', () => {
  test('on the Spray tab: the tab, one stop for the cans, one for the caps, Undo, Cancel and Tag it', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...propsOf({ canUndo: true, hasDraft: true })} />);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 7; i++) { await user.tab(); seen.push(focusedName()); }
    expect(seen).toEqual(['Hide tools', 'Spray', 'Cyan', 'Stock', 'Undo', 'Cancel', 'Tag it']);
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('radio'), ...screen.getAllByRole('tab')]) expect(control).toHaveAccessibleName();
  });

  test('on the Stencils tab: the stencils, the cans, the spots, Cancel and Tag it', async () => {
    const user = userEvent.setup();
    render(<Toolbar {...propsOf({ tab: 'stencils', stencil: 'crown', hasDraft: true })} />);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 7; i++) { await user.tab(); seen.push(focusedName()); }
    expect(seen).toEqual(['Hide tools', 'Stencils', 'Crown', 'Cyan', 'Middle center', 'Cancel', 'Tag it']);
    for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('radio'), ...screen.getAllByRole('tab')]) expect(control).toHaveAccessibleName();
  });

  test('has two tabs, Spray and Stencils, in a tablist, and the panel is named by its tab', () => {
    render(<Toolbar {...propsOf()} />);
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Spray', 'Stencils']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(screen.getByRole('tabpanel', { name: 'Spray' })).toBeInTheDocument();
  });

  test('the arrow keys move between the tabs', async () => {
    const user = userEvent.setup();
    render(<Kept />);
    await user.tab();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Stencils' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Stencils' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Stencils' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Cap' })).toBeNull();
  });
});

describe('the cans and the caps are radiogroups', () => {
  test('fourteen cans, each named by its color, the group named Can', () => {
    render(<Toolbar {...propsOf()} />);
    const cans = within(screen.getByRole('radiogroup', { name: 'Can' })).getAllByRole('radio');
    expect(cans.map((c) => c.getAttribute('aria-label'))).toEqual(CAN_NAMES);
    expect(cans).toHaveLength(14);
    expect(screen.getByRole('radio', { name: 'Cyan' })).toBeChecked();
  });

  test('the caps are Skinny, Stock and Fat in a group named Cap', () => {
    render(<Toolbar {...propsOf()} />);
    const caps = within(screen.getByRole('radiogroup', { name: 'Cap' })).getAllByRole('radio');
    expect(caps.map((c) => c.textContent)).toEqual(['Skinny', 'Stock', 'Fat']);
    expect(screen.getByRole('radio', { name: 'Stock' })).toBeChecked();
  });

  test('arrow keys move the choice and the focus, wrapping at the ends, and Home and End go to the first and the last', async () => {
    const user = userEvent.setup();
    render(<Kept />);
    await user.click(screen.getByRole('radio', { name: 'Cyan' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Teal' })).toBeChecked();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Silver' })).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Black' })).toBeChecked();
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Black' })).toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Silver' })).toBeChecked();
  });

  test('the caps move the same way, and only the chosen one is a stop', async () => {
    const user = userEvent.setup();
    render(<Kept />);
    const caps = within(screen.getByRole('radiogroup', { name: 'Cap' })).getAllByRole('radio');
    expect(caps.map((c) => c.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    await user.click(screen.getByRole('radio', { name: 'Stock' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Fat' })).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Skinny' })).toBeChecked();
  });
});

describe('the meter', () => {
  test('names the can at the left and says the wall with this drawing, and the limit, at the right', () => {
    render(<Toolbar {...propsOf({ meter: { wall: 3100, after: 3100, most: 4000, over: false } })} />);
    expect(screen.getByText('Cyan', { selector: '[data-kb-meter-can]' })).toBeInTheDocument();
    expect(screen.getByText('Wall 31% of 40%')).toBeInTheDocument();
  });

  test('counts the drawing as it grows', () => {
    render(<Toolbar {...propsOf({ hasDraft: true, meter: { wall: 3100, after: 3650, most: 4000, over: false } })} />);
    expect(screen.getByText('Wall 36% of 40%')).toBeInTheDocument();
  });
});

describe('Tag it', () => {
  test('is not ready while the drawing is empty, and says why under it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Toolbar {...propsOf({ onSubmit })} />);
    const go = screen.getByRole('button', { name: 'Tag it' });
    expect(go).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Draw something first')).toBeInTheDocument();
    expect(go).toHaveAccessibleDescription('Draw something first');
    await user.click(go);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('is not ready over the limit, and gives the figures', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Toolbar {...propsOf({ onSubmit, hasDraft: true, meter: { wall: 3100, after: 4600, most: 4000, over: true } })} />);
    const go = screen.getByRole('button', { name: 'Tag it' });
    expect(go).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('This tag would take the wall to 46%; its limit is 40%')).toBeInTheDocument();
    expect(screen.getByText('Wall 46% of 40%')).toBeInTheDocument();
    await user.click(go);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('over the limit by a part of a percent, the meter and the reason name the same figure', () => {
    render(<Toolbar {...propsOf({ hasDraft: true, meter: { wall: 3100, after: 4001, most: 4000, over: true } })} />);
    expect(screen.getByText('Wall 41% of 40%')).toBeInTheDocument();
    expect(screen.getByText('This tag would take the wall to 41%; its limit is 40%')).toBeInTheDocument();
  });

  test('is ready with a drawing inside the limit, says nothing under it, and sends', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Toolbar {...propsOf({ onSubmit, hasDraft: true, meter: { wall: 3100, after: 3500, most: 4000, over: false } })} />);
    const go = screen.getByRole('button', { name: 'Tag it' });
    expect(go).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('Draw something first')).toBeNull();
    await user.click(go);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('on the Stencils tab with nothing chosen it asks for a stencil', () => {
    render(<Toolbar {...propsOf({ tab: 'stencils' })} />);
    expect(screen.getByText('Choose a stencil first')).toBeInTheDocument();
  });

  test('is not ready while it is sending, and a refusal is shown in the toolbar', () => {
    render(<Toolbar {...propsOf({ hasDraft: true, busy: true, refusal: 'The wall is full.' })} />);
    expect(screen.getByRole('button', { name: 'Tag it' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('The wall is full.');
  });
});

describe('Undo and Cancel', () => {
  test('Undo is there to take the last stroke back, and cannot be pressed with none', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const { rerender } = render(<Toolbar {...propsOf({ onUndo, canUndo: false })} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    rerender(<Toolbar {...propsOf({ onUndo, canUndo: true })} />);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  test('Cancel calls out', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Toolbar {...propsOf({ onCancel })} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a question put before leaving is asked in the toolbar, with Leave and Stay', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn(), onStay = vi.fn();
    render(<Toolbar {...propsOf({ asking: 'Leave without tagging? Your drawing isn\'t saved.', onLeave, onStay })} />);
    expect(screen.getByText('Leave without tagging? Your drawing isn\'t saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onLeave).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(onStay).toHaveBeenCalled();
  });

  test('a notice, such as the bound a drawing reached, is read out and not an error', () => {
    render(<Toolbar {...propsOf({ notice: 'That is the most one tag can hold.' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('That is the most one tag can hold.');
  });
});

describe('the Stencils tab', () => {
  test('six stencils drawn from their strokes, each named, in a group named Stencil', () => {
    render(<Toolbar {...propsOf({ tab: 'stencils' })} />);
    const group = screen.getByRole('radiogroup', { name: 'Stencil' });
    const stencils = within(group).getAllByRole('radio');
    expect(stencils).toHaveLength(STENCIL_KEYS.length);
    expect(stencils.map((s) => s.getAttribute('aria-label'))).toEqual(['Mustache', 'Horns', 'Crown', 'Kilroy was here', 'Big X', 'Smiley']);
    for (const s of stencils) expect(s.querySelector('svg path, svg polyline')).not.toBeNull();
  });

  test('nine spots in a grid, Top left to Bottom right, and the cans are here too', () => {
    render(<Toolbar {...propsOf({ tab: 'stencils' })} />);
    const spots = within(screen.getByRole('radiogroup', { name: 'Spot' })).getAllByRole('radio');
    expect(spots.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Top left', 'Top center', 'Top right', 'Middle left', 'Middle center', 'Middle right', 'Bottom left', 'Bottom center', 'Bottom right',
    ]);
    expect(screen.getByRole('radio', { name: 'Middle center' })).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: 'Can' })).getAllByRole('radio')).toHaveLength(14);
  });

  test('choosing a stencil and a spot, by arrows too, is told to the drawing', async () => {
    const user = userEvent.setup();
    render(<Kept />);
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    await user.click(screen.getByRole('radio', { name: 'Crown' }));
    expect(screen.getByRole('radio', { name: 'Crown' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Middle center' }));
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Top center' })).toBeChecked();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Top left' })).toBeChecked();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Middle left' })).toBeChecked();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Middle left' }), { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Bottom right' })).toBeChecked();
  });

  test('focusOnMount focuses the first control without scrolling the page away from the post', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      render(<Toolbar {...propsOf({ focusOnMount: true })} />);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally { focus.mockRestore(); }
  });

  test('the dock measures the thread column beside its own height, so a wide dock lines up with the posts and the page keeps its foot clear', () => {
    const root = document.documentElement;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = this.classList.contains('kb-acts') ? { left: 120, right: 920 } : { left: 0, right: 0 };
      return { ...r, top: 0, bottom: 0, width: r.right - r.left, height: 0, x: r.left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const width = vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(1000);
    try {
      const { unmount } = render(<div className="kb-acts"><Toolbar {...propsOf()} /></div>);
      expect(root.style.getPropertyValue('--kb-graffiti-dock-left')).toBe('120px');
      expect(root.style.getPropertyValue('--kb-graffiti-dock-right')).toBe('80px');
      expect(root.style.getPropertyValue('--kb-graffiti-dock-h')).not.toBe('');
      unmount();
      for (const v of ['--kb-graffiti-dock-left', '--kb-graffiti-dock-right', '--kb-graffiti-dock-h']) expect(root.style.getPropertyValue(v)).toBe('');
    } finally { rect.mockRestore(); width.mockRestore(); }
  });

  test('the dock is hosted by the posts\' table, never inside a post, whose isolation would trap its z-index under the posts that follow', () => {
    document.body.innerHTML = '<div class="kb-acts"><article class="kb-act" style="isolation: isolate"><div class="kb-act-main"><p id="words"></p></div></article></div><div id="loose"></div>';
    const words = document.getElementById('words');
    expect(dockHostOf(words)).toBe(document.querySelector('.kb-acts'));
    /* Off the thread's table, the post itself; with neither, nothing. */
    document.body.innerHTML = '<article class="kb-act"><p id="words"></p></article>';
    expect(dockHostOf(document.getElementById('words'))).toBe(document.querySelector('.kb-act'));
    expect(dockHostOf(document.body)).toBeNull();
    expect(dockHostOf(null)).toBeNull();
  });
});

describe('the dock collapses to its header', () => {
  const toggle = () => screen.getByRole('button', { name: /^(Hide|Show) tools$/ });

  test('a disclosure button in the header, open by default, controls the tools', () => {
    render(<Toolbar {...propsOf()} />);
    expect(toggle()).toHaveTextContent('Hide tools');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const tools = document.getElementById(toggle().getAttribute('aria-controls')!)!;
    expect(tools).not.toBeNull();
    expect(tools).toContainElement(screen.getByRole('tablist'));
    expect(tools).toContainElement(screen.getByRole('radiogroup', { name: 'Can' }));
  });

  test('collapsed, the tools leave the accessibility tree and Cancel, Tag it and the reason stay', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Toolbar {...propsOf({ onCancel })} />);
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveTextContent('Show tools');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Tag it' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Draw something first')).toBeVisible();
    expect(screen.getByText('Cyan')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  test('opened again, the same can, cap and tab are there, and a keyboard works the button', async () => {
    const user = userEvent.setup();
    render(<Kept />);
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.click(screen.getByRole('radio', { name: 'Fat' }));
    await user.click(screen.getByRole('tab', { name: 'Stencils' }));
    toggle().focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('tab')).toBeNull();
    await user.keyboard(' ');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tab', { name: 'Stencils' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: 'Red' })).toBeChecked();
    await user.click(screen.getByRole('tab', { name: 'Spray' }));
    expect(screen.getByRole('radio', { name: 'Fat' })).toBeChecked();
  });
});
