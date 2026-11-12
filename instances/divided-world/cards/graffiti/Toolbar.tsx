/**
 * Graffiti's toolbar (docs/plans/2026-11-11-graffiti-design.md, sections 8, 9 and 11; plan Task 10): the glass's dock with its cyan seam, in
 * the owner's style D of the mockup (docs/research/2026-11-11-graffiti/01-tool-styles.html) with the design's changes. From the top: the meter
 * (the can's name, and the wall with this drawing, as a figure and over a thin skewed bar), two tabs, **Spray** (fourteen drawn cans, three
 * caps, Undo) and **Stencils** (six stencils, the cans, and nine spots), then Cancel and Tag it, with the reason Tag it
 * waits under it in plain words.
 *
 * It keeps nothing: DrawMode (Compose.tsx) holds the drawing and the choices and gives them here, so this is the view and every control
 * of it is the glass's, named, and reachable by keyboard. The cans, the caps, the stencils and the spots are radio groups with one stop each and
 * the arrow keys, Home and End; the tabs are a tablist. Tag it is `aria-disabled` and not `disabled`, so it stays a stop a keyboard or a
 * screen reader reaches and reads its reason from. Everything it draws is `data-kb-over-ink`: a press on it is the toolbar's and starts no
 * stroke, on this card or any other that is scrubbed.
 */
import { createElement, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CANS, CAPS, type Can, type Cap } from '../graffiti.ts';
import { CAN_VIEWBOX, canShapes } from './can.svg.ts';
import { overWords, percent, type Meter } from './draft.ts';
import { STENCILS, STENCIL_KEYS, type StencilKey } from './stencils.ts';
import { CAN_NAMES, CAP_NAMES, SPOT_NAMES, STENCIL_NAMES } from './words.ts';

export type ToolbarTab = 'spray' | 'stencils';

export interface ToolbarProps {
  readonly can: Can;
  readonly onCan: (can: Can) => void;
  readonly cap: Cap;
  readonly onCap: (cap: Cap) => void;
  readonly tab: ToolbarTab;
  readonly onTab: (tab: ToolbarTab) => void;
  readonly stencil: StencilKey | null;
  readonly onStencil: (stencil: StencilKey) => void;
  /** 0 to 8, left to right and top to bottom. */
  readonly spot: number;
  readonly onSpot: (spot: number) => void;
  readonly meter: Meter;
  /** The drawing the visible tab makes is not empty: strokes on Spray, a stencil on Stencils. */
  readonly hasDraft: boolean;
  /** There is a stroke to take back. */
  readonly canUndo: boolean;
  readonly onUndo: () => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
  /** The play is on its way. */
  readonly busy: boolean;
  /** The refusal of the last try, in the database's words; the drawing is kept. */
  readonly refusal: string | null;
  /** Something plain to say about the drawing that is no error (a bound it reached). */
  readonly notice: string | null;
  /** The question put before leaving, while it is asked here: the toolbar then shows Leave and Stay. */
  readonly asking: string | null;
  readonly onLeave: () => void;
  readonly onStay: () => void;
  /** Move focus to the toolbar's first control when it opens, for a keyboard that pressed the card's button to get here. */
  readonly focusOnMount?: boolean;
}

/** A drawn can, in the color it holds. Decoration: the control it is on names it. */
export function CanArt({ color, className }: { readonly color: string; readonly className?: string }) {
  return (
    <svg className={className} viewBox={CAN_VIEWBOX} aria-hidden="true" focusable="false">
      {canShapes(color).map(({ tag, attrs }, i) => createElement(tag, { key: i, ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()), v])) }))}
    </svg>
  );
}

/** A stencil drawn from its own strokes in a unit box, at the widths its caps spray over a third of a post's width. */
function StencilArt({ stencil }: { readonly stencil: StencilKey }) {
  return (
    <svg viewBox="0 0 1 1" aria-hidden="true" focusable="false">
      {STENCILS[stencil].strokes.map((s, i) => (
        <path
          key={i}
          d={`M${s.points.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join('L')}${s.points.length === 1 ? 'l0.001 0' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={Math.max(CAPS[s.cap] * 3, 0.035)} strokeLinecap="round" strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

interface Choice<T> { readonly value: T; readonly name: string; readonly node?: ReactNode; readonly className?: string }

/** A radio group, as the platform's: one tab stop (the chosen, or the first where none is), arrows move and choose, Home and End go to the ends. `cols` makes it a grid, whose Up and Down move a row. */
function Radios<T extends string | number>({ label, choices, value, onChange, cols = 1, className }: {
  readonly label: string; readonly choices: readonly Choice<T>[]; readonly value: T | null; readonly onChange: (value: T) => void; readonly cols?: number; readonly className: string;
}) {
  const chosen = choices.findIndex((c) => c.value === value);
  const stop = chosen >= 0 ? chosen : 0;
  const n = choices.length;
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = Number((e.target as HTMLElement).closest<HTMLElement>('[role="radio"]')?.dataset.index);
    if (!Number.isInteger(at)) return;
    const row = cols > 1;
    const to = e.key === 'ArrowRight' ? (at + 1) % n
      : e.key === 'ArrowLeft' ? (at - 1 + n) % n
      : e.key === 'ArrowDown' ? (row ? (at + cols < n ? at + cols : at) : (at + 1) % n)
      : e.key === 'ArrowUp' ? (row ? (at - cols >= 0 ? at - cols : at) : (at - 1 + n) % n)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    onChange(choices[to]!.value);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={className} onKeyDown={move}>
      {choices.map((c, i) => (
        <button
          key={String(c.value)} type="button" role="radio" aria-checked={i === chosen} aria-label={c.name} data-index={i}
          tabIndex={i === stop ? 0 : -1} className={c.className} data-kb-chosen={i === chosen ? 'true' : undefined} onClick={() => onChange(c.value)}
        >
          {c.node}
        </button>
      ))}
    </div>
  );
}

const CAN_CHOICES = (Object.keys(CANS) as Can[]).map((can): Choice<Can> => ({ value: can, name: CAN_NAMES[can], className: 'kb-graffiti-pick', node: <CanArt color={CANS[can]} /> }));
const CAP_CHOICES = (Object.keys(CAPS) as Cap[]).map((cap): Choice<Cap> => ({ value: cap, name: CAP_NAMES[cap], className: 'kb-graffiti-btn', node: <span>{CAP_NAMES[cap]}</span> }));
const STENCIL_CHOICES = STENCIL_KEYS.map((k): Choice<StencilKey> => ({ value: k, name: STENCIL_NAMES[k], className: 'kb-graffiti-stencil', node: <StencilArt stencil={k} /> }));
const SPOT_CHOICES = SPOT_NAMES.map((name, i): Choice<number> => ({ value: i, name, className: 'kb-graffiti-spot' }));
const TABS: readonly { readonly key: ToolbarTab; readonly name: string }[] = [{ key: 'spray', name: 'Spray' }, { key: 'stencils', name: 'Stencils' }];

/**
 * Where the dock is mounted for the post a card is played on: the posts' table (`.kb-acts`), else the post. A post is isolated (thread.css), so a dock fixed inside it has its
 * z-index trapped in that post and every post after it paints over the dock; in the table it lies over all of them. The dock's controls come after the posts in the tab order.
 */
export const dockHostOf = (el: Element | null): HTMLElement | null => el?.closest<HTMLElement>('.kb-acts') ?? el?.closest<HTMLElement>('.kb-act') ?? null;

export function Toolbar(p: ToolbarProps) {
  const id = useId();
  const dock = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => { if (p.focusOnMount) first.current?.focus({ preventScroll: true }); }, [p.focusOnMount]);
  useEffect(() => {
    if (p.asking !== null) stay.current?.focus();
    else if (wasAsking.current) cancel.current?.focus();
    wasAsking.current = p.asking !== null;
  }, [p.asking]);

  /* The dock is fixed to the foot of the window at every width and would hide the last of the page: the page keeps its height clear (graffiti.css). Wide, it lines up with the
     thread's column, which the page does not name in a variable, so the toolbar measures the column's edges (the posts' table, else the page's column) beside its own height. */
  useLayoutEffect(() => {
    const el = dock.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const column = el.closest<HTMLElement>('.kb-acts') ?? el.closest<HTMLElement>('.kb-page');
    const size = () => {
      root.style.setProperty('--kb-graffiti-dock-h', `${el.offsetHeight}px`);
      if (!column) return;
      const at = column.getBoundingClientRect();
      root.style.setProperty('--kb-graffiti-dock-left', `${Math.max(0, Math.round(at.left))}px`);
      root.style.setProperty('--kb-graffiti-dock-right', `${Math.max(0, Math.round(root.clientWidth - at.right))}px`);
    };
    root.setAttribute('data-kb-graffiti-dock', '');
    size();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
    watch?.observe(el);
    if (column) watch?.observe(column);
    window.addEventListener('resize', size);
    return () => {
      watch?.disconnect();
      window.removeEventListener('resize', size);
      root.removeAttribute('data-kb-graffiti-dock');
      for (const v of ['--kb-graffiti-dock-h', '--kb-graffiti-dock-left', '--kb-graffiti-dock-right']) root.style.removeProperty(v);
    };
  }, []);

  const ready = p.hasDraft && !p.meter.over && !p.busy;
  const reason = p.busy ? null : !p.hasDraft ? (p.tab === 'stencils' ? 'Choose a stencil first' : 'Draw something first') : p.meter.over ? overWords(p.meter) : null;
  const reasonId = `${id}-reason`;
  const fill = p.meter.most > 0 ? Math.min(100, (p.meter.wall / p.meter.most) * 100) : 0;
  const reach = p.meter.most > 0 ? Math.min(100, (p.meter.after / p.meter.most) * 100) : 0;

  const tabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.key === p.tab);
    const to = e.key === 'ArrowRight' ? (at + 1) % TABS.length : e.key === 'ArrowLeft' ? (at - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    p.onTab(TABS[to]!.key);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };

  return (
    <div ref={dock} className="kb-graffiti-dock" role="group" aria-label="Graffiti tools" data-kb-over-ink data-kb-dock>
      <div className="kb-graffiti-label">
        <span data-kb-meter-can>{CAN_NAMES[p.can]}</span>
        <span>{`Wall ${p.meter.over ? Math.ceil(p.meter.after / 100) : percent(p.meter.after)}% of ${percent(p.meter.most)}%`}</span>
      </div>
      <div className="kb-graffiti-meter" data-over={p.meter.over ? 'true' : undefined} aria-hidden="true">
        <i className="kb-graffiti-meter-wall" style={{ width: `${fill}%` }} />
        <i className="kb-graffiti-meter-add" style={{ left: `${fill}%`, width: `${Math.max(0, reach - fill)}%` }} />
      </div>

      <div role="tablist" aria-label="Tools" className="kb-graffiti-tabs" onKeyDown={tabKey}>
        {TABS.map((t, i) => (
          <button
            key={t.key} ref={i === 0 ? first : undefined} type="button" role="tab" id={`${id}-tab-${t.key}`} aria-selected={p.tab === t.key} aria-controls={`${id}-panel`}
            tabIndex={p.tab === t.key ? 0 : -1} className="kb-graffiti-btn" onClick={() => p.onTab(t.key)}
          >
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${p.tab}`} className="kb-graffiti-panel">
        {p.tab === 'stencils' && (
          <Radios label="Stencil" className="kb-graffiti-stencils" choices={STENCIL_CHOICES} value={p.stencil} onChange={p.onStencil} />
        )}
        <Radios label="Can" className="kb-graffiti-cans" choices={CAN_CHOICES} value={p.can} onChange={p.onCan} />
        {p.tab === 'spray' ? (
          <div className="kb-graffiti-row">
            <Radios label="Cap" className="kb-graffiti-caps" choices={CAP_CHOICES} value={p.cap} onChange={p.onCap} />
            <button type="button" className="kb-graffiti-btn" disabled={!p.canUndo} onClick={p.onUndo}><span>Undo</span></button>
          </div>
        ) : (
          <Radios label="Spot" className="kb-graffiti-spots" choices={SPOT_CHOICES} value={p.spot} onChange={p.onSpot} cols={3} />
        )}
      </div>

      {p.notice !== null && <p className="kb-graffiti-notice" role="status">{p.notice}</p>}
      {p.refusal !== null && <p className="kb-graffiti-refusal" role="alert">{p.refusal}</p>}

      {p.asking !== null ? (
        <div className="kb-graffiti-ask" role="group" aria-label="Leave without tagging?">
          <p>{p.asking}</p>
          <div className="kb-graffiti-row">
            <button ref={stay} type="button" className="kb-graffiti-btn" onClick={p.onStay}><span>Stay</span></button>
            <button type="button" className="kb-graffiti-btn" onClick={p.onLeave}><span>Leave</span></button>
          </div>
        </div>
      ) : (
        <>
          <div className="kb-graffiti-row">
            <button ref={cancel} type="button" className="kb-graffiti-btn" disabled={p.busy} onClick={p.onCancel}><span>Cancel</span></button>
            <button
              type="button" className="kb-graffiti-btn kb-graffiti-go" aria-disabled={!ready} aria-busy={p.busy || undefined} aria-describedby={reason !== null ? reasonId : undefined}
              onClick={() => { if (ready) p.onSubmit(); }}
            >
              <span>Tag it</span>
            </button>
          </div>
          {reason !== null && <p id={reasonId} className="kb-graffiti-reason">{reason}</p>}
        </>
      )}
    </div>
  );
}
