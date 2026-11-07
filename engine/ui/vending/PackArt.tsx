/**
 * A pack drawn as the foil pack the machine sells (the booster packs boards, docs/research/2026-11-07-booster-packs/): a wrapper at a card's
 * 2:3, crimped at both ends, carrying the instance's art, its mark, its name and its count. The wrapper's art, its mark and its colors are the
 * instance's (`InstanceUi.packs`, placed as a card's face art is); the engine draws only the shape and the printing on it. It is decoration, so
 * it is hidden from a screen reader and marked `data-kb-art`: what a pack is called and costs is said by the slot's own name.
 *
 * `part="opened"` is the pack after it has torn open: the same wrapper cut along a jagged line, the part below the tear, which the reveal parks at the
 * top of its screen with only its foot in view.
 *
 * Its size is `--kb-pack-w` (86px by default, a card slot's); every measure is a share of it, as a card's are of `--kb-pc-w`.
 */
import type { CSSProperties } from 'react';
import type { CardArt } from '../cards/types.ts';
import './pack.css';

export interface PackArtProps {
  readonly name: string;
  /** How many cards it holds, said on the wrapper ("5 CARDS"). */
  readonly count: number;
  readonly art?: Pick<CardArt, 'color' | 'ink'> & Partial<Pick<CardArt, 'canvas' | 'mark'>>;
  readonly part?: 'whole' | 'opened';
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
