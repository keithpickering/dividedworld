/**
 * The kit: the controls a card puts on a post, drawn by the engine as glass tiles (marks-and-the-lens design; plan Task 2).
 * A card says only what each control does (`KitControl`); the engine draws them, so every card's controls share one floor
 * of size, focus and labels, at the glass's own face and size tokens (kit.css). At most two are drawn: a card that needs
 * more has more to say than a post has room for, and says it in the Lens instead.
 *
 * `hold` is Whoops!'s "Hold to scrub" handling, moved here with the same behavior (and one addition: it is stopped if it unmounts mid-hold, as Whoops! stops its sweep on unmount): it starts on pointer down or on Space or
 * Enter (never on the key's auto-repeat, which would start it again and again), and stops on pointer up, leave or cancel,
 * on key up and on blur, so a hold that loses its pointer or its focus can never be left running. The context menu is
 * swallowed (a long press on a touch screen would open it and cancel the hold).
 */
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Link } from '../router.tsx';
import type { KitControl } from './types.ts';
import './kit.css';

/** The most controls the kit draws. */
export const KIT_MAX = 2;

const swallow = (e: { preventDefault(): void }) => e.preventDefault();
const isActivation = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';

type TileProps = ButtonHTMLAttributes<HTMLButtonElement> & { readonly 'data-kb-lit'?: ''; readonly 'data-kb-hold'?: '' };

function Tile({ children, ...rest }: TileProps) {
  return <button type="button" className="kb-kit-tile" {...rest}><span className="kb-kit-tile-label">{children}</span></button>;
}

function Hold({ control }: { readonly control: Extract<KitControl, { kind: 'hold' }> }) {
  const help = useId();
  const live = useRef(control);
  live.current = control;
  const holding = useRef(false);
  const start = () => { holding.current = true; control.start(); };
  const stop = () => { holding.current = false; control.stop(); };
  /* Gone mid-hold (the post scrolled away, the card taken off): stopped once, as the hold would have been by a release. */
  useEffect(() => () => { if (holding.current) live.current.stop(); }, []);
  return (
    <>
      <Tile
        data-kb-hold="" data-kb-lit="" aria-describedby={control.describe ? help : undefined}
        onPointerDown={(e: PointerEvent) => { swallow(e); start(); }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onBlur={stop}
        onContextMenu={swallow}
        onKeyDown={(e: KeyboardEvent) => { if (!isActivation(e)) return; e.preventDefault(); if (!e.repeat) start(); }}
        onKeyUp={(e: KeyboardEvent) => { if (isActivation(e)) stop(); }}
      >
        {control.label}
      </Tile>
      {control.describe && <span id={help} className="kb-visually-hidden">{control.describe}</span>}
    </>
  );
}

function One({ control }: { readonly control: KitControl }) {
  switch (control.kind) {
    case 'hold': return <Hold control={control} />;
    case 'press': return <Tile onClick={control.run}>{control.label}</Tile>;
    case 'toggle': return <Tile aria-pressed={control.on} onClick={() => control.set(!control.on)}>{control.label}</Tile>;
    /* A choice's options stand in the kit's one row with the controls beside them; its label stands over the whole row (Kit). */
    case 'choose': return <>{control.options.map((o) => <Tile key={o.value} aria-pressed={o.value === control.value} onClick={() => control.choose(o.value)}>{o.label}</Tile>)}</>;
    case 'go': return <Link to={control.to} className="kb-kit-tile"><span className="kb-kit-tile-label">{control.label}</span></Link>;
  }
}

export function Kit({ card, controls, ink }: {
  /** The card's key or name: the development warning names it. */
  readonly card: string;
  readonly controls: readonly KitControl[];
  /** The card's color, which lit tiles take; the glass's own sweet when none. */
  readonly ink?: string;
}) {
  const labelId = useId();
  if (controls.length > KIT_MAX && import.meta.env.DEV) {
    console.warn(`Kit: card "${card}" gave ${controls.length} controls; only the first ${KIT_MAX} are drawn.`);
  }
  const drawn = controls.slice(0, KIT_MAX);
  if (drawn.length === 0) return null;
  const style = ink ? ({ '--kb-tag': ink } as CSSProperties) : undefined;
  const row = drawn.map((c, i) => <One key={`${c.kind}:${i}`} control={c} />);
  const chosen = drawn.find((c): c is Extract<KitControl, { kind: 'choose' }> => c.kind === 'choose');
  /* A choice is named: its label (Whoops!'s "Your tools, as the author") stands over one row of every control the kit draws, the hold and the options together. */
  return chosen
    ? (
      <div className="kb-kit kb-kit-named" style={style} role="group" aria-labelledby={labelId}>
        <p id={labelId} className="kb-kit-label">{chosen.label}</p>
        <div className="kb-kit-row">{row}</div>
      </div>
    )
    : <div className="kb-kit" style={style}>{row}</div>;
}
