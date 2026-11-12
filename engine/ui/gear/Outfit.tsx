/**
 * What a character wears over its portrait (the cosmetics design, section 2). The layer is a sibling of the picture inside a box the
 * picture fills, so a piece's fractions are the portrait's own: its center `x` and `y` of the box, its width `w` of the box's width, its
 * height by the art's own shape. Each piece is an `<img>` of the instance's art file for that gear, the same URL for every wearer, so the
 * browser fetches each item once. The layer is decoration: the character's name says who it is, and no screen reader is told of a hat.
 *
 * On the tall portrait the layer is cut at `gear.reach` of the portrait's width past each edge, so a cap may stand above the slot but not
 * across the page (outfit.css). Its parent must set `container-type: inline-size`: `cqw` there resolves against it (the postbit's and the profile's slots do). On the square, which is cut from inside the portrait, each piece is mapped through the square's frame
 * (`inSquare`) and the layer is cut at the square's edge; a piece wholly outside it is not drawn at all.
 */
import type { CSSProperties } from 'react';
import { inSquare, type Piece, type SquareFrame } from '../../rules/cosmetics.ts';
import { useKayfa } from '../context.tsx';
import './outfit.css';

/** The tall slot's own shape (width 1, height `tallness`) where the portrait's is known; undefined lets the picture's own size set it. */
export function slotShape(tallness: number | null): CSSProperties | undefined {
  return tallness === null ? undefined : { aspectRatio: `1 / ${tallness}` };
}

/** A fraction as a percentage, without the noise of float arithmetic. */
const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

/** Whether a piece's turned box, in the box's own fractions, touches the box at all. `aspect` is the art's height over its width, and the box is as wide as tall in pixels (the square). */
function touchesSquare(p: Piece, aspect: number): boolean {
  const rad = (p.turn * Math.PI) / 180;
  const w = p.w;
  const h = p.w * aspect;
  const hx = (w * Math.abs(Math.cos(rad)) + h * Math.abs(Math.sin(rad))) / 2;
  const hy = (w * Math.abs(Math.sin(rad)) + h * Math.abs(Math.cos(rad))) / 2;
  return p.x + hx > 0 && p.x - hx < 1 && p.y + hy > 0 && p.y - hy < 1;
}

export function Outfit({ pieces, on, frame = null }: {
  readonly pieces: readonly Piece[];
  readonly on: 'portrait' | 'square';
  /** The square's frame in the portrait; with none the square has nothing to map through and wears nothing. */
  readonly frame?: SquareFrame | null;
}) {
  const { ui, instance } = useKayfa();
  const drawn: { readonly piece: Piece; readonly art: string; readonly aspect: number }[] = [];
  for (const raw of pieces) {
    const gear = ui.gear[raw.gear];
    if (!gear) continue;
    let piece = raw;
    if (on === 'square') {
      if (!frame) continue;
      piece = inSquare(raw, frame);
      if (!touchesSquare(piece, gear.aspect)) continue;
    }
    drawn.push({ piece, art: gear.art, aspect: gear.aspect });
  }
  if (drawn.length === 0) return null;
  drawn.sort((a, b) => a.piece.layer - b.piece.layer);
  const style = { '--kb-reach': instance.settings.cosmetics.gear.reach } as CSSProperties;
  return (
    <span className="kb-outfit" data-kb-on={on} aria-hidden="true" style={style}>
      {drawn.map(({ piece, art, aspect }, i) => (
        <img
          key={`${piece.layer}-${i}`} src={art} alt="" loading="lazy" decoding="async" draggable={false}
          style={{ left: pct(piece.x), top: pct(piece.y), width: pct(piece.w), aspectRatio: `1 / ${aspect}`, transform: `translate(-50%, -50%) rotate(${piece.turn}deg)`, zIndex: i }}
        />
      ))}
    </span>
  );
}
