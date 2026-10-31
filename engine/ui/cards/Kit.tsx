/**
 * The kit: the controls a card puts on a post, drawn by the engine as glass tiles (marks-and-the-lens design; plan Task 2).
 * A card says only what each control does (`KitControl`); the engine draws them, so every card's controls share one floor
 * of size, focus and labels, at the glass's own face and size tokens (kit.css). At most two are drawn: a card that needs
 * more has more to say than a post has room for, and says it in the Lens instead.
 *
 * `hold` is Whoops!'s "Hold to scrub" handling, moved here unchanged in behavior: it starts on pointer down or on Space or
 * Enter (never on the key's auto-repeat, which would start it again and again), and stops on pointer up, leave or cancel,
 * on key up and on blur, so a hold that loses its pointer or its focus can never be left running. The context menu is
 * swallowed (a long press on a touch screen would open it and cancel the hold).
 */
import { useId, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Link } from '../router.tsx';
import type { KitControl } from './types.ts';
import './kit.css';

/** The most controls the kit draws. */
export const KIT_MAX = 2;

const swallow = (e: { preventDefault(): void }) => e.preventDefault();
const isActivation = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';

function Tile({ children, ...rest }: { readonly children: ReactNode } & Record<string, unknown>) {
  return <button type="button" className="kb-kit-tile" {...rest}><span className="kb-kit-tile-label">{children}</span></button>;
}

function Hold({ control }: { readonly control: Extract<KitControl, { kind: 'hold' }> }) {
  const help = useId();
  const { start, stop } = control;
  return (
    <>
      <Tile
        data-kb-lit="" aria-describedby={control.describe ? help : undefined}
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
    case 'choose':
      return (
        <span className="kb-kit-group" role="group" aria-label={control.label}>
          <span className="kb-kit-group-label" aria-hidden="true">{control.label}</span>
          {control.options.map((o) => <Tile key={o.value} aria-pressed={o.value === control.value} onClick={() => control.choose(o.value)}>{o.label}</Tile>)}
        </span>
      );
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
  if (controls.length > KIT_MAX && import.meta.env.DEV) {
    console.warn(`Kit: card "${card}" gave ${controls.length} controls; only the first ${KIT_MAX} are drawn.`);
  }
  const drawn = controls.slice(0, KIT_MAX);
  if (drawn.length === 0) return null;
  return (
    <div className="kb-kit" style={ink ? ({ '--kb-tag': ink } as CSSProperties) : undefined}>
      {drawn.map((c, i) => <One key={i} control={c} />)}
    </div>
  );
}
