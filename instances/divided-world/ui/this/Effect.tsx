/**
 * THIS's effect on a post (docs/plans/2026-11-13-this-design.md, sections 2, 3 and 6; plan Task 7): a note under the words the caster points at.
 *
 * Each play's phrase is found by the engine's one matcher over the post's visible text (place.ts, memoized on the post's body and the plays, so a
 * render that changes neither runs no search). A phrase that is there is a **wedge**, a `wrap` run of a `TextLayer`:
 * - its words are drawn in `span.dw-this-hl`, the highlighter's swipe, wherever no other card's run covers them (the run lies under Laugh Track's
 *   and Autocorrect's, so a cue fires and a tape keeps the words);
 * - its **trail** stands (`stands`, the engine's standing trail): `span.dw-this-gap`, an inline box of no width right after the phrase's last word,
 *   drawn whatever run is drawn there, so the line opens under a taped phrase too. It holds one visually hidden line, the note as a screen reader
 *   reads it, and is `data-kb-quotable="hidden"` and `data-dw-aside`, so no quote of the post and no readout of its lines holds it;
 * - the **drawn note** (`div.dw-this-note`: THIS, the words, an arrow) is a child of `.dw-this`, outside `.kb-bb`, `aria-hidden`. It takes no pointer
 *   or key handler and no z-index, so ink laid over the post covers it as it covers the words and a press goes to that ink.
 * A phrase that is not there, because the post was edited, is a **receipt**: `aside.dw-this-receipt` after the words, quoting the phrase as the play's own
 * configuration names it. Nothing here assumes a wedge ever stood: a play set on a quote may be a receipt from the start. Nothing is read from the
 * post's history, and nothing here names a caster.
 *
 * **Measuring.** The gap is opened by the effect, which sets its height, places each note at its gap and points its arrow at the phrase's last line
 * piece (place.ts `layOut`, boxes in, numbers out). A gap's height is the line's, the note's and the arrow's room, and never depends on where anything
 * is, so one pass is the fixed point: it reads each box, writes each height that is not already written, reads the tops again where it wrote one, and
 * places each note and arrow that is not already placed. A pass over its own result writes nothing, so the `ResizeObserver` of `.dw-this`, which sees
 * the gaps make it taller, ends after one more look. It runs in a layout effect when the places or words change, on that observer, and when the
 * marker's face has loaded. It measures against its own `.dw-this`, never an ancestor, and not at all while the wrapper has no width (a folded post).
 * A gap with no boxes (the phrase is inside a closed [spoiler]) is skipped and its note is hidden; opening the spoiler resizes the wrapper, and the
 * observer places it. A play's moment draws the same and watches the same size, since it can be mounted folded and shown later.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { forgedList, forgedSet } from '../../../../engine/bbcode/quoted.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { layOut, placesOf, type Spot } from './place.ts';
import './this.css';

/** Below Laugh Track's -1 and Autocorrect's 0: a cue on the same words fires and a tape keeps them. */
const Z = -2;

const wordsOf = (play: CardPlay): string => (typeof play.config['words'] === 'string' ? (play.config['words'] as string) : '');
const phraseOf = (play: CardPlay): string => play.config['phrase'] as string;
/** The note as a screen reader reads it, in the gap. */
const heard = (words: string): string => `Note on these words: THIS${words ? ` ${words}` : ''}.`;
/** A play in force: not face down, caught, ended by an admin or untaken (the engine hands over only these; this holds it for a card that is handed more). */
const inForce = (p: CardPlay): boolean => !p.faceDown && !p.caught && !p.reversed && !p.untaken;

/** The height of one line of the words around `el`. */
function lineHeightOf(el: HTMLElement): number {
  const style = window.getComputedStyle(el);
  return Number.parseFloat(style.lineHeight) || 1.25 * (Number.parseFloat(style.fontSize) || 16);
}

export function ThisEffect({ post, plays, show, children }: EffectProps) {
  const body = typeof post.currentPayload.body === 'string' ? post.currentPayload.body : '';
  /* A forged quote (the Act's verdict) is a counterfeit, so its words are the poster's own and count (forged-quotes design, section 1). */
  const forged = forgedList(post.currentPayload);
  const text = useMemo(() => visibleText(parse(body, undefined, forgedSet(forged))), [body, forged]);
  /* The plays by content, so a new array of equal plays is not a new set of places. */
  const playsKey = JSON.stringify(plays.map((p) => [p.id, p.config, inForce(p)]));
  const places = useMemo(() => placesOf(text, plays.filter(inForce)), [text, playsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const wedges = useMemo(() => places.filter((p): p is typeof p & { at: NonNullable<typeof p.at> } => p.at !== null), [places]);

  /* A gap that mounts is measured in the commit that mounts it: an inline spoiler draws its words at another place in the tree shut and open, so pressing it remounts the gap with no height, and neither this effect's layout effect nor the observer would look before the frame is drawn. A pass over its own result writes nothing, so this cannot loop. */
  const measureNow = useRef<() => void>(() => {});
  const gapRef = useCallback((el: HTMLSpanElement | null) => { if (el) measureNow.current(); }, []);

  const runs = useMemo<TextRun[]>(() => wedges.map(({ play, at }): TextRun => {
    const line = heard(wordsOf(play));
    return {
      start: at.start, end: at.end, key: `this:${play.id}`, z: Z, mode: 'wrap', stands: true,
      render: ({ text: words, key }) => <span key={key} className="dw-this-hl" data-dw-this-piece={play.id}>{words}</span>,
      trail: (key) => (
        <span key={key} ref={gapRef} className="dw-this-gap" data-dw-this-gap={play.id} data-kb-quotable="hidden" data-dw-aside="">
          <span className="kb-visually-hidden">{line}</span>
        </span>
      ),
    };
  }), [wedges, gapRef]);

  /* What the Lens says: the count, and a line for each play, which names no caster. */
  const view = useMemo<CardView | null>(() => (places.length === 0 ? null : {
    progress: null,
    state: places.length === 1 ? '1 note' : `${places.length} notes`,
    yours: false,
    controls: [],
    notes: Object.fromEntries(places.map(({ play, at }) => [play.id, `“${phraseOf(play)}”${at === null ? ' (edited out)' : ''}: THIS${wordsOf(play) ? ` ${wordsOf(play)}` : ', no words'}`])),
  }), [places]);
  const viewKey = JSON.stringify(view);
  const viewNow = useRef(view);
  viewNow.current = view;
  useEffect(() => { show(viewNow.current); }, [viewKey, show]);

  const host = useRef<HTMLDivElement>(null);
  const measure = () => {
    const el = host.current;
    if (!el || wedges.length === 0) return;
    const box = el.getBoundingClientRect();
    /* Not laid out (folded, or hidden): nothing to read. The observer looks again when the wrapper has a size. */
    if (box.width <= 0) return;
    const gapOf = new Map<string, HTMLElement>();
    const noteOf = new Map<string, HTMLElement>();
    for (const g of el.querySelectorAll<HTMLElement>('[data-dw-this-gap]')) gapOf.set(g.dataset['dwThisGap']!, g);
    for (const n of el.querySelectorAll<HTMLElement>('[data-dw-this-note]')) noteOf.set(n.dataset['dwThisNote']!, n);
    /* A gap with no boxes (inside a closed [spoiler], or under any hidden ancestor) has no place: its note is hidden again and nothing is written for it. The others are laid out without it. */
    const shown = new Set<string>();
    for (const { play } of wedges) {
      const gap = gapOf.get(play.id), note = noteOf.get(play.id);
      if (!gap || !note) continue;
      /* No boxes, or boxes in a skipped subtree (a shut [spoiler]'s content keeps its boxes in Chromium, so its note would be drawn over the next line): not shown. */
      if (gap.getClientRects().length === 0 || (typeof gap.checkVisibility === 'function' && !gap.checkVisibility())) note.removeAttribute('data-placed');
      else shown.add(play.id);
    }
    const read = (): Spot[] => wedges.flatMap(({ play }): Spot[] => {
      const gap = gapOf.get(play.id), note = noteOf.get(play.id);
      if (!gap || !note || !shown.has(play.id)) return [];
      const at = gap.getBoundingClientRect();
      /* The element right before the gaps at this place is whatever is drawn for the phrase's last piece (the highlight, a cue, a tape's segment): its last box is the last line piece. Otherwise, a piece ending where the phrase does. */
      let before: Node | null = gap.previousSibling;
      while (before instanceof HTMLElement && before.hasAttribute('data-dw-this-gap')) before = before.previousSibling;
      const rects = before instanceof HTMLElement ? before.getClientRects() : null;
      const last = rects && rects.length ? rects[rects.length - 1]! : null;
      const word = note.querySelector('.dw-this-word')?.getBoundingClientRect();
      return [{
        id: play.id,
        lineTop: at.top - box.top,
        lineHeight: lineHeightOf(gap),
        noteHeight: note.getBoundingClientRect().height,
        wordX: word ? word.left - box.left + word.width * 0.55 : 0,
        piece: last ? { left: last.left - box.left, width: last.width } : { left: at.left - box.left - 28, width: 28 },
      }];
    });
    let laid = layOut(read(), box.width);
    let wrote = false;
    for (const l of laid) {
      const gap = gapOf.get(l.id)!;
      if (gap.style.height !== `${l.gapHeight}px`) { gap.style.height = `${l.gapHeight}px`; wrote = true; }
    }
    /* A height written moves every line below it; the tops are read again, and the heights, which do not depend on them, come out the same. */
    if (wrote) laid = layOut(read(), box.width);
    for (const l of laid) {
      const note = noteOf.get(l.id)!;
      if (note.style.top !== `${l.noteTop}px`) note.style.top = `${l.noteTop}px`;
      const path = note.querySelector('path');
      if (path && path.getAttribute('d') !== l.arrow) path.setAttribute('d', l.arrow);
      if (!note.hasAttribute('data-placed')) note.setAttribute('data-placed', '');
    }
  };
  measureNow.current = measure;
  const layoutKey = JSON.stringify(wedges.map(({ play, at }) => [play.id, at.start, at.end, wordsOf(play)]));
  useLayoutEffect(() => { measureNow.current(); }, [layoutKey]);
  useEffect(() => {
    let live = true;
    const again = () => { if (live) measureNow.current(); };
    /* Watched in a moment too: a moment can be mounted folded or hidden and shown later, and looking at a size binds nothing a player can reach and saves nothing. A `<details>` opening or closing changes the wrapper's size, so this observer alone re-measures a spoiler; no `toggle` listener is needed. */
    /* Looked at in the next frame, not in the observer's own delivery: a pass that writes a height changes the wrapper's size, and a write made while the observer is delivering is the browser's "ResizeObserver loop completed with undelivered notifications" error. */
    let queued = false;
    let frame = 0;
    const later = () => {
      if (queued) return;
      queued = true;
      frame = requestAnimationFrame(() => { queued = false; again(); });
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
    if (host.current) resize?.observe(host.current);
    /* The marker's face changes the notes' height when it arrives. */
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    void Promise.all([fonts?.load?.('1em "Permanent Marker"'), fonts?.ready]).then(again, () => {});
    return () => { live = false; resize?.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  const receipts = places.filter((p) => p.at === null);
  return (
    <div ref={host} className="dw-this">
      <TextLayer runs={runs}>{children}</TextLayer>
      {wedges.map(({ play }) => {
        const words = wordsOf(play);
        return (
          <div key={play.id} className="dw-this-note" data-dw-this-note={play.id} data-dw-aside="" aria-hidden="true">
            <svg className="dw-this-arrow" focusable="false" aria-hidden="true"><path d="" /></svg>
            <span className="dw-this-word">THIS</span>
            {words ? <>{' '}<span className="dw-this-words">{words}</span></> : null}
          </div>
        );
      })}
      {receipts.map(({ play }) => (
        <aside key={play.id} className="dw-this-receipt" role="note" data-dw-aside="" data-dw-this-receipt={play.id}>
          {`THIS “${phraseOf(play)}” (edited out)${wordsOf(play) ? ` ${wordsOf(play)}` : ''}`}
        </aside>
      ))}
    </div>
  );
}
