/**
 * The reaction picker: a 2x2 grid shaped like the circumplex (excited at the top, negative on the
 * left), each quadrant a group of its emoji. One tab stop; the arrow keys move through the buttons in
 * the grid as it looks: Left and Right along a row of the whole grid, Up and Down along a column of it
 * (across into the quadrant above or below), Home and End to the first and last, Escape closes and returns focus to the React button. A
 * popover by the button on a desktop and a sheet above the HUD on a phone (the same element; the
 * stylesheet places it). It leaves when a choice is made, on Escape, on Close, on a tap outside, or
 * when focus moves away.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, MyCharacter, MyReaction } from '../data/api.ts';
import type { Quadrant } from '../../rules/types.ts';
import { usePlayer } from '../player.tsx';
import type { Tallies } from '../thread/tallies.ts';
import type { Mine } from './mine.ts';
import { readable } from './Reactions.tsx';

/** Top-left, top-right, bottom-left, bottom-right. */
const GRID: readonly Quadrant[] = ['excitedNegative', 'excitedPositive', 'boredNegative', 'calmPositive'];
/** How many kinds a quadrant holds side by side (reactions.css lays them in this many columns). */
export const KIND_COLUMNS = 2;

/**
 * Where each kind sits in the whole grid: a row and a column, the quadrants' own rows and columns
 * laid end to end. A quadrant's kinds fill its columns left to right and then down; the top quadrants
 * are as tall as the fuller of the two, so a column runs straight down into the quadrant below.
 */
export function cells(counts: readonly number[]): readonly (readonly { readonly row: number; readonly col: number }[])[] {
  const topRows = Math.ceil(Math.max(counts[0] ?? 0, counts[1] ?? 0) / KIND_COLUMNS);
  return counts.map((n, q) =>
    Array.from({ length: n }, (_, i) => ({ row: (q < 2 ? 0 : topRows) + Math.floor(i / KIND_COLUMNS), col: (q % 2) * KIND_COLUMNS + (i % KIND_COLUMNS) })));
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
  readonly as: MyCharacter | null;
  readonly own: readonly MyReaction[];
  readonly tallies: Tallies;
  readonly mine: Mine;
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly onClose: (refocus: boolean) => void;
}

export function Picker({ act, as, own, tallies, mine, trigger, onClose }: Props) {
  const { api, instance, ui, settings } = useKayfa();
  const player = usePlayer();
  const root = useRef<HTMLDivElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cap = settings.reactionCap;
  const kinds = new Set(own.map((o) => o.kind));
  const left = Math.max(0, cap - kinds.size);
  const free = (k: string) => left > 0 && !kinds.has(k);
  const buttons = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('.kb-picker-grid button:not(:disabled)') ?? [])];

  /* On open, focus the first kind that can be left; with none, the picker itself. */
  useEffect(() => { (buttons()[0] ?? root.current)?.focus(); }, []);

  /* A tap outside closes it. */
  useEffect(() => {
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !trigger.current?.contains(t)) onClose(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose, trigger]);

  const move = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
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
    if (!as || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.react(act, as.id, kind);
      if (!answer.ok) { setRefusal(answer.error); return; }
      mine.add({ act, kind, character: as.id });
      tallies.merge(act, answer.value.tally);
      player.reactionLanded();
      onClose(true);
    } catch {
      setRefusal('The reaction could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  let first = true;
  const grid = cells(GRID.map((q) => instance.reactions.filter((r) => r.quadrant === q).length));
  return (
    <div
      ref={root} className="kb-picker kb-sheet" role="dialog" aria-label={`React as ${as?.name ?? 'your character'}`} tabIndex={-1}
      aria-busy={busy || undefined} onKeyDown={move}
      onBlur={(e) => { const to = e.relatedTarget as Node | null; if (to && !root.current?.contains(to) && !trigger.current?.contains(to)) onClose(false); }}
    >
      <div className="kb-picker-head">
        <span className="kb-picker-left">{left} of {cap} left</span>
        <button type="button" className="kb-button kb-picker-close" onClick={() => onClose(true)}>Close</button>
      </div>
      {left === 0 && <p className="kb-picker-none kb-small">You have left all {cap} of your reactions on this post. You cannot leave another.</p>}
      {left > 0 && (
        <>
          <div className="kb-picker-axis kb-small kb-muted" aria-hidden="true"><span>Excited</span></div>
          <div className="kb-picker-grid">
            {GRID.map((q, qi) => (
              <div key={q} className="kb-picker-quad" role="group" aria-label={ui.quadrantLabels[q]} data-kb-quadrant={q}>
                <div className="kb-picker-label kb-small kb-muted" aria-hidden="true">{ui.quadrantLabels[q]}</div>
                <div className="kb-picker-kinds">
                  {instance.reactions.filter((r) => r.quadrant === q).map((r, ki) => {
                    const ok = free(r.key);
                    const tab = ok && first;
                    if (ok) first = false;
                    return (
                      <button
                        key={r.key} type="button" className="kb-picker-kind" disabled={!ok} tabIndex={tab ? 0 : -1}
                        data-kb-reaction={r.key} data-kb-row={grid[qi]![ki]!.row} data-kb-col={grid[qi]![ki]!.col} data-kb-own={kinds.has(r.key) ? '' : undefined}
                        aria-label={`${readable(r.key)}, ${ui.quadrantLabels[q]}${kinds.has(r.key) ? ', already left' : ''}`}
                        onClick={() => void choose(r.key)}
                      >
                        <span aria-hidden="true">{r.emoji}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="kb-picker-axis kb-small kb-muted" aria-hidden="true"><span>Calm</span></div>
        </>
      )}
      {refusal && <p className="kb-notice kb-picker-refusal" data-kb-tone="refusal" role="alert">{refusal}</p>}
    </div>
  );
}
