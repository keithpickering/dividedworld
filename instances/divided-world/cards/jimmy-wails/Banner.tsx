/**
 * Jimmy Wails's banner (docs/plans/2026-11-03-jimmy-wails-design.md, section 6; plan Task 7): one play's plate with its caster's words laid on it as
 * real text.
 *
 * The plate is the one the server drew at the play (`CardPlay.drawn`); a key the pool no longer holds draws the first plate, so an old play never
 * breaks. The banner is laid out in the plate's own pixels (a stage `width` plus its panel wide) and scaled by one factor to the post's width, so the
 * words sit where the plate set them at any size. The picture is decoration (`alt=""`) and the figure is named "Appeal from {caster}"; the words are
 * text a reader or a screen reader gets as any other.
 *
 * **The fit.** The words are "Please read:" small, the message large and "A personal appeal from {caster}". The message's size steps down from
 * 28 px to 13 px until the stack fits the box (`fitSize`, a pure function of a measurer, so a test gives it a fake: jsdom has no layout). It is
 * measured once the banner is laid out and again when its box resizes or the page's fonts arrive, never on a frame.
 *
 * The plate's own colors (its ink and its panel) are the picture's, the same on either board, as Autocorrect's tape keeps its own.
 *
 * **The credit.** The plates are photographs used under a license that asks for their photographer's name, the license and a note that the
 * picture was changed (plates.ts, `credit`). It is a line under the banner, in the board's own type and outside the picture, so the appeal reads as
 * it did: "Photo: Lane Hartwell, CC BY-SA 3.0, edited", the name linked to the photograph's page and the license to its deed.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CardPlay } from '../../../../engine/ui/cards/types.ts';
import { PLATES, type Plate } from '../../ui/jimmy-wails/plates.ts';

export const MAX_SIZE = 28;
export const MIN_SIZE = 13;

/** The plate a play was drawn on: its drawn key's, or the first plate's for a key the pool no longer holds (or a play with none). */
export function plateOf(play: Pick<CardPlay, 'drawn'>): Plate {
  return PLATES.find((p) => p.key === play.drawn) ?? PLATES[0]!;
}

export interface Extent { readonly w: number; readonly h: number }

/**
 * The largest whole size, from `max` down to `min`, at which what `measure(size)` says the words take fits `box`; `min` when none does (the words
 * then run on past the box rather than disappear).
 */
export function fitSize(measure: (size: number) => Extent, box: Extent, max: number = MAX_SIZE, min: number = MIN_SIZE): number {
  for (let size = max; size > min; size -= 1) {
    const taken = measure(size);
    if (taken.w <= box.w && taken.h <= box.h) return size;
  }
  return min;
}

export interface BannerProps {
  readonly play: CardPlay;
  /** The caster's name as the screen knows it. */
  readonly caster: string;
}

export function Banner({ play, caster }: BannerProps) {
  const plate = plateOf(play);
  const wide = plate.width + (plate.panel?.width ?? 0);
  const figure = useRef<HTMLElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(MAX_SIZE);
  const [scale, setScale] = useState(1);

  const layout = useCallback(() => {
    const host = figure.current;
    const el = words.current;
    if (host && host.clientWidth > 0) setScale(host.clientWidth / wide);
    if (!el) return;
    const fit = fitSize((s) => {
      el.style.setProperty('--dw-jw-size', `${s}px`);
      return { w: el.scrollWidth, h: el.scrollHeight };
    }, { w: plate.box.w, h: plate.box.h });
    /* The last size measured is not always the one chosen (the floor is never measured), so the element is set to the choice itself. */
    el.style.setProperty('--dw-jw-size', `${fit}px`);
    setSize(fit);
  }, [wide, plate.box.w, plate.box.h]);

  /* Measured once laid out, and again on resize, a new message and the page's fonts arriving (a face that measures differently). */
  useLayoutEffect(() => {
    layout();
    const host = figure.current;
    const watch = typeof ResizeObserver === 'undefined' || !host ? null : new ResizeObserver(layout);
    if (host) watch?.observe(host);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) layout(); });
    return () => { live = false; watch?.disconnect(); };
  }, [layout, play.message, caster]);

  return (
    <>
    <figure ref={figure} className="dw-jw-banner" aria-label={`Appeal from ${caster}`} data-plate={plate.key} style={{ aspectRatio: `${wide} / ${plate.height}` }}>
      <div className="dw-jw-stage" style={{ width: wide, height: plate.height, transform: `scale(${scale})` }}>
        {plate.panel ? <div className="dw-jw-panel" style={{ left: plate.width, width: plate.panel.width, background: plate.panel.color }} /> : null}
        <img className="dw-jw-plate" src={plate.src} alt="" width={plate.width} height={plate.height} draggable={false} />
        <div
          ref={words} className="dw-jw-words" data-size={size}
          style={{ left: plate.box.x, top: plate.box.y, width: plate.box.w, height: plate.box.h, color: plate.ink, ['--dw-jw-size' as string]: `${size}px` }}
        >
          <p className="dw-jw-lead">Please read:</p>
          <p className="dw-jw-message">{play.message}</p>
          <p className="dw-jw-by">A personal appeal from {caster}</p>
        </div>
      </div>
    </figure>
    <p className="dw-jw-credit">
      Photo: <a href={plate.credit.source} rel="noopener noreferrer">{plate.credit.author}</a>, <a href={plate.credit.licenseUrl} rel="noopener noreferrer">{plate.credit.license}</a>, edited
    </p>
    </>
  );
}
