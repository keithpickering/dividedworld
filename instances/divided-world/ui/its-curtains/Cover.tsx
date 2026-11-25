/**
 * It's Curtains' row cover (docs/plans/2026-11-23-its-curtains-design.md, section 2.3; the plan's Task 6): what the engine mounts over a thread's whole post row,
 * the postbit included, while a play of the card is shut for this reader (engine/ui/thread/cover.tsx). It draws the outermost shut curtain from `plays`, in its
 * fabric, and the next one under it, so it shows as the halves part. The engine holds which curtains the reader has opened and makes the row under `inert`; this
 * only draws, counts "1 of 3" from the outermost, and tells the engine when the halves are out.
 */
import type { CoverProps } from '../../../../engine/ui/cards/types.ts';
import { Curtain } from './Curtain.tsx';
import { fabricOf } from './fabric.ts';

export function ItsCurtainsCover({ plays, cover }: CoverProps) {
  const top = plays[0];
  if (!top) return null;
  const next = plays[1];
  return (
    <Curtain
      key={top.id} fabric={fabricOf(top)} under={next ? fabricOf(next) : undefined} seed={top.id}
      n={cover.total - cover.shut + 1} total={cover.total} onOpened={cover.open}
    />
  );
}
