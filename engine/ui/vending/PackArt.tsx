/**
 * A pack drawn as the foil pack the machine sells (the booster packs boards, docs/research/2026-11-07-booster-packs/): a wrapper at a card's
 * 2:3, crimped at both ends, carrying the instance's art, its mark, its name and its count. The wrapper's art, its mark and its colors are the
 * instance's (`InstanceUi.packs`, placed as a card's face art is); the engine draws only the shape and the printing on it. It is decoration, so
 * it is hidden from a screen reader and marked `data-kb-art`: what a pack is called and costs is said by the slot's own name.
 *
 * `part="opened"` is the pack after it has torn open: the same wrapper cut along a jagged line, the part below the tear, which the reveal parks at the
 * top of its screen with only its foot in view.
 *
 * `part="top"` is the other piece of the torn pack: the crimped top above the same tear line, cut along the line's other side. The engine gives the line, so any pack art tears the same
 * way; the reveal draws the two pieces one over the other (a whole pack) and rips the top away.
 *
 * With `art.picture` the pack is a picture of the whole pack on a transparent ground instead (specs/card-art.md): its outline is the pack's, so the engine
 * crimps and prints nothing but the count, and a relief, when given, lights it (`PackLight`). The torn parts cut that picture along the tear line alone.
 *
 * Its size is `--kb-pack-w` (86px by default, a card slot's); every measure is a share of it, as a card's are of `--kb-pc-w`.
 */
import type { CSSProperties } from 'react';
import type { PackArtLook } from '../cards/types.ts';
import { PackLight } from './packLight.ts';
import './pack.css';

export interface PackArtProps {
  readonly name: string;
  /** How many cards it holds, said on the wrapper ("5 CARDS"). */
  readonly count: number;
  readonly art?: Pick<PackArtLook, 'color' | 'ink'> & Partial<Pick<PackArtLook, 'canvas' | 'mark' | 'picture' | 'relief'>>;
  readonly part?: 'whole' | 'opened' | 'top';
  /** The pack's width in px; the wrapper is a half as tall again. */
  readonly width?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function PackArt({ name, count, art, part = 'whole', width = 86, className, style }: PackArtProps) {
  const vars = {
    '--kb-pack-w': `${width}px`,
    ...(art ? { '--kb-pack-color': art.color, '--kb-pack-ink': art.ink } : {}),
    ...(art?.canvas ? { '--kb-pack-canvas': `url("${art.canvas}")` } : {}),
    ...style,
  } as CSSProperties;
  if (art?.picture) {
    return (
      <span className={`kb-pack${className ? ` ${className}` : ''}`} data-part={part} data-kb-pictured="" aria-hidden="true" data-kb-art style={vars}>
        <img className="kb-pack-picture" src={art.picture} alt="" draggable={false} decoding="async" />
        <span className="kb-pack-count" data-kb-text={`${count} cards`} />
        {art.relief ? <PackLight picture={art.picture} relief={art.relief} part={part} /> : null}
      </span>
    );
  }
  return (
    <span className={`kb-pack${className ? ` ${className}` : ''}`} data-part={part} aria-hidden="true" data-kb-art style={vars}>
      <span className="kb-pack-seal kb-pack-seal-top" />
      <span className="kb-pack-seal kb-pack-seal-foot" />
      <span className="kb-pack-sheen" />
      {art?.mark ? <img className="kb-pack-mark" src={art.mark} alt="" draggable={false} /> : null}
      {/* Printed from attributes by the stylesheet, so no word of it is text a button's label is read against (WCAG 2.5.3): the slot's own name says the pack and its count. */}
      <span className="kb-pack-name" data-kb-text={name} />
      <span className="kb-pack-count" data-kb-text={`${count} cards`} />
    </span>
  );
}
