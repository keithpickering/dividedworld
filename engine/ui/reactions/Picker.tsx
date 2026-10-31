/**
 * The reaction picker: a 2x2 grid shaped like the circumplex (excited at the top, negative on the
 * left), each quadrant a group of its emoji, as the React board draws it
 * (docs/research/2026-10-29-two-worlds/03-react.html): a glass overlay (engine/ui/glass/Overlay.tsx)
 * on the `react` smoke, named for the post it reacts to, with the count in its bar and the hint at
 * its foot. Each quadrant wears the class the instance gives it (`InstanceUi.quadrantClasses`): its
 * tint, and its label in the class's large text.
 *
 * One tab stop; the arrow keys move through the buttons in the grid as it looks: Left and Right
 * along a row of the whole grid, Up and Down along a column of it (across into the quadrant above
 * or below), Home and End to the first and last. Where the window has the popover's room (its
 * 540px with the phone's 16px gutters) the picker opens by its post and a quadrant's kinds are four
 * across, as the board draws them in its 900px window; in a narrower window (a phone) it is a sheet
 * above the HUD and they are two across. The overlay holds focus and Tab, closes on Esc, Close or a
 * press on the dimmed page, and returns focus to React; a choice made closes it too.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, MyCharacter, MyReaction } from '../data/api.ts';
import type { Quadrant } from '../../rules/types.ts';
import { Overlay, type Placed } from '../glass/Overlay.tsx';
import { usePlayer } from '../player.tsx';
import type { Tallies } from '../thread/tallies.ts';
import type { Mine } from './mine.ts';
import { readable } from './Reactions.tsx';

/** Top-left, top-right, bottom-left, bottom-right. */
const GRID: readonly Quadrant[] = ['excitedNegative', 'excitedPositive', 'boredNegative', 'calmPositive'];
/** How many kinds a quadrant holds side by side: four in the popover, two on the sheet (reactions.css lays them so). */
export const KIND_COLUMNS = { popover: 4, sheet: 2 } as const;
/** The popover's width, the board's: reactions.css draws it at this (Reactions.test.tsx holds the two together). */
export const POPOVER_WIDTH = 540;
/** The room the popover needs: its width with the phone's 16px gutters either side. */
export const POPOVER_ROOM = POPOVER_WIDTH + 2 * 16;

/**
 * Where each kind sits in the whole grid: a row and a column, the quadrants' own rows and columns
 * laid end to end. A quadrant's kinds fill its columns left to right and then down; the top quadrants
 * are as tall as the fuller of the two, so a column runs straight down into the quadrant below.
 */
export function cells(counts: readonly number[], columns: number): readonly (readonly { readonly row: number; readonly col: number }[])[] {
  const topRows = Math.ceil(Math.max(counts[0] ?? 0, counts[1] ?? 0) / columns);
  return counts.map((n, q) =>
    Array.from({ length: n }, (_, i) => ({ row: (q < 2 ? 0 : topRows) + Math.floor(i / columns), col: (q % 2) * columns + (i % columns) })));
}

/** The enabled button a key moves to from one, or null when the key moves nowhere. */
function target(key: string, all: readonly HTMLButtonElement[], at: number): number | null {
  const pos = (b: HTMLButtonElement) => ({ row: Number(b.dataset.kbRow), col: Number(b.dataset.kbCol) });
  const here = pos(all[at]!);
  let best: number | null = null;
  let score = Infinity;
  all.forEach((b, i) => {
    const p = pos(b);
    let gap: number;
    if (key === 'ArrowRight') gap = p.row === here.row ? p.col - here.col : 0;
    else if (key === 'ArrowLeft') gap = p.row === here.row ? here.col - p.col : 0;
    else if (key === 'ArrowDown') gap = p.col === here.col ? p.row - here.row : 0;
    else gap = p.col === here.col ? here.row - p.row : 0;
    if (gap > 0 && gap < score) { score = gap; best = i; }
  });
  return best;
}

interface Props {
  readonly act: Id;
  /** What is reacted to, as the thread names it, for the dialog's name ("Alex's post", "Mrs. Hooligan's Whoops!"). */
  readonly subject: string;
  readonly as: MyCharacter | null;
  readonly own: readonly MyReaction[];
  readonly tallies: Tallies;
  readonly mine: Mine;
  /** The post's reactions row, which the picker opens by. */
  readonly anchor: RefObject<HTMLElement | null>;
  readonly onClose: (refocus: boolean) => void;
}

export function Picker({ act, subject, as, own, tallies, mine, anchor, onClose }: Props) {
  const { api, instance, ui, settings } = useKayfa();
  const player = usePlayer();
  const [placed, setPlaced] = useState<Placed | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const countId = useId();
  const describedId = useId();
  const cap = settings.reactionCap;
  const kinds = new Set(own.map((o) => o.kind));
  const left = Math.max(0, cap - kinds.size);
  const free = (k: string) => left > 0 && !kinds.has(k);
  const columns = KIND_COLUMNS[placed === 'sheet' ? 'sheet' : 'popover'];
  const buttons = () => [...(grid.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const move = (e: KeyboardEvent) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (all.length === 0 || at < 0) return;
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') to = target(e.key, all, at) ?? at;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = all.length - 1;
    if (to === null) return;
    e.preventDefault();
    all.forEach((b, i) => { b.tabIndex = i === to ? 0 : -1; });
    all[to]!.focus();
  };

  const choose = async (kind: string) => {
    if (!as || sending.current) return;
    sending.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.react(act, as.id, kind);
      if (!answer.ok) {
        setRefusal(answer.error);
        /* A refusal may mean what this screen holds is stale (another tab left that kind): read the player's own again. */
        mine.merge(act, await api.myReactions([act]).catch(() => []));
        return;
      }
      mine.add({ act, kind, character: as.id });
      tallies.merge(act, answer.value.tally);
      player.reactionLanded();
      /* Closed meanwhile (Esc, Close): the reaction still counts, but focus is not taken back. */
      if (alive.current) onClose(true);
    } catch {
      setRefusal('The reaction could not be sent. Try again.');
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  let first = true;
  const at = cells(GRID.map((q) => instance.reactions.filter((r) => r.quadrant === q).length), columns);
  return (
    <Overlay
      title={<span className="kb-calm">React</span>} label={`React to ${subject}`} surface="react" className="kb-picker"
      describedBy={describedId} closeAt="foot" anchor={anchor} sheetBelow={POPOVER_ROOM} onPlace={setPlaced} onClose={() => onClose(true)}
      aside={<span id={countId} className="kb-picker-left kb-calm" role="status">{left} of {cap} left</span>}
    >
      {/* What the dialog is described by: the count, and the mask the reaction goes out under (the HUD's, which the overlay dims). */}
      <span id={describedId} hidden>{left} of {cap} left, reacting as {as?.name ?? 'your character'}</span>
      <div className="kb-picker-body" aria-busy={busy || undefined} onKeyDown={move}>
        {left === 0 && <p className="kb-picker-none kb-calm">You have left all {cap} of your reactions on this post. You cannot leave another.</p>}
        {left > 0 && (
          <div className="kb-picker-field">
            <span className="kb-picker-axis kb-calm" data-kb-axis="top" aria-hidden="true">Excited</span>
            <div ref={grid} className="kb-picker-grid" data-kb-columns={columns} style={{ '--kb-picker-columns': columns } as CSSProperties}>
              {GRID.map((q, qi) => {
                const cls = ui.quadrantClasses?.[q];
                const worn = cls === undefined ? undefined : ({
                  '--kb-picker-large': `var(--kb-glass-class-${cls}-large)`,
                  '--kb-picker-fill': `var(--kb-glass-class-${cls}-fill)`,
                } as CSSProperties);
                return (
                  <div key={q} className="kb-picker-quad" role="group" aria-labelledby={`${countId}-${q}`} data-kb-quadrant={q} style={worn}>
                    <div id={`${countId}-${q}`} className="kb-picker-label kb-glass-display kb-calm">{ui.quadrantLabels[q]}</div>
                    <div className="kb-picker-kinds">
                      {instance.reactions.filter((r) => r.quadrant === q).map((r, ki) => {
                        const ok = free(r.key);
                        const tab = ok && first;
                        if (ok) first = false;
                        return (
                          <button
                            key={r.key} type="button" className="kb-picker-kind" disabled={!ok} tabIndex={tab ? 0 : -1}
                            data-kb-reaction={r.key} data-kb-row={at[qi]![ki]!.row} data-kb-col={at[qi]![ki]!.col} data-kb-own={kinds.has(r.key) ? '' : undefined}
                            aria-label={`${readable(r.key)}, ${ui.quadrantLabels[q]}${kinds.has(r.key) ? ', your reaction' : ''}`}
                            onClick={() => void choose(r.key)}
                          >
                            <span aria-hidden="true">{r.emoji}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="kb-picker-axis kb-calm" data-kb-axis="bottom" aria-hidden="true">Low-key</span>
            <span className="kb-picker-cross" data-kb-cross="across" aria-hidden="true" />
            <span className="kb-picker-cross" data-kb-cross="down" aria-hidden="true" />
          </div>
        )}
        {refusal && <p className="kb-notice kb-picker-refusal kb-calm" data-kb-tone="refusal" role="alert">{refusal}</p>}
        {left > 0 && <p className="kb-picker-hint kb-calm">Arrow keys move, Enter reacts. Outlined: yours.</p>}
      </div>
    </Overlay>
  );
}
