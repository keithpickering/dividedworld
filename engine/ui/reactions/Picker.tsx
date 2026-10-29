/**
 * The reaction picker: a 2x2 grid shaped like the circumplex (excited at the top, negative on the
 * left), each quadrant a group of its emoji. One tab stop; the arrow keys move through the buttons in
 * reading order, Home and End to the ends, Escape closes and returns focus to the React button. A
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
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = Math.min(all.length - 1, at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = Math.max(0, at - 1);
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
            {GRID.map((q) => (
              <div key={q} className="kb-picker-quad" role="group" aria-label={ui.quadrantLabels[q]} data-kb-quadrant={q}>
                <div className="kb-picker-label kb-small kb-muted" aria-hidden="true">{ui.quadrantLabels[q]}</div>
                <div className="kb-picker-kinds">
                  {instance.reactions.filter((r) => r.quadrant === q).map((r) => {
                    const ok = free(r.key);
                    const tab = ok && first;
                    if (ok) first = false;
                    return (
                      <button
                        key={r.key} type="button" className="kb-picker-kind" disabled={!ok} tabIndex={tab ? 0 : -1}
                        data-kb-reaction={r.key} data-kb-own={kinds.has(r.key) ? '' : undefined}
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
