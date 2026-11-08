/**
 * Highlight-to-quote, in the board world: while the document's selection lies inside one post's rendered words, a small Quote
 * button stands beside the selection's end. Pressing it quotes the selection into the reply box and clears the selection. A
 * selection that crosses posts, or lies outside a body (the postbit, a signature, the reactions), shows nothing. The whole-post
 * Quote button and trimming in the reply box stay the keyboard path.
 *
 * What is quoted is what the post SHOWED, read by walking the selected range through the body's own DOM, never `Selection.toString()`:
 * that would carry a shut spoiler's hidden words, the spoiler's screen-reader name, a picture's alt text and the words of a layer
 * that left (inert), and a quote must never hold words the reader did not see. The walk leaves out anything hidden from sight or
 * from a screen reader (`aria-hidden`, `hidden`, `inert`, `.kb-visually-hidden`), a Lens, a shut `<details>`'s body, a quoted
 * author's line (it names the author, it is not the post's words) and anything that is not text (images, video). A line break
 * stays a line break, between paragraphs and at a `<br>`.
 *
 * The data-kb-quotable contract. A renderer says what a quote may hold by marking an element, and the mark outranks every other
 * rule above on that element (the engine never names an instance's classes; an instance marks its own markup):
 *   data-kb-quotable="shown"   words the post shows although they are aria-hidden (a layer that replaces the words under it, such as
 *                              a strip of label tape bearing its replacement): read.
 *   data-kb-quotable="hidden"  chrome or words the post does not show as its own (a control, a face label, the words a layer covers,
 *                              an older version drawn inside the same article): skipped, and a selection that starts or ends in one
 *                              is no selection of the post.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Act } from '../data/api.ts';

export interface Selected {
  /** The post body the selection lies in. */
  readonly body: HTMLElement;
  /** The post's number in its thread. */
  readonly seq: number;
  /** The shown words selected. */
  readonly text: string;
}

const BODY = '.kb-bb';
const SKIPPED = '[aria-hidden="true"], [hidden], [inert], .kb-visually-hidden, .kb-lens, cite.kb-quote-from, script, style, template, img, svg, video, iframe, audio, canvas';
/** What a renderer marked an element as: see the contract above. */
const quotable = (el: Element) => el.getAttribute('data-kb-quotable');
const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'DETAILS', 'SUMMARY']);

/** The post body a node is in: a post's own words, not a signature's, with the number of the post it belongs to. */
function bodyAt(node: Node): { readonly body: HTMLElement; readonly seq: number } | null {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const body = el?.closest<HTMLElement>(BODY);
  if (!body || el?.closest('[data-kb-quotable="hidden"]') || body.closest('.kb-signature')) return null;
  const seq = Number(body.closest('article.kb-act')?.getAttribute('data-kb-seq'));
  return Number.isInteger(seq) && seq > 0 ? { body, seq } : null;
}

/** The shown words of `range` inside `body`. */
function shownWords(body: HTMLElement, range: Range): string {
  let out = '';
  const line = () => { out = out.replace(/[ \t]+$/u, ''); if (out !== '' && !out.endsWith('\n')) out += '\n'; };
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      if (!range.intersectsNode(n)) return;
      const data = (n as Text).data;
      const part = data.slice(n === range.startContainer ? range.startOffset : 0, n === range.endContainer ? range.endOffset : data.length);
      /* A line starts at its first word: the space a skipped element left behind is not the line's. */
      out += out.endsWith('\n') ? part.replace(/^[ \t]+/u, '') : part;
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const mark = quotable(el);
    if (mark === 'hidden' || (mark !== 'shown' && el.matches(SKIPPED)) || !range.intersectsNode(el)) return;
    if (el.tagName === 'BR') { out += '\n'; return; }
    const block = BLOCKS.has(el.tagName);
    if (block) line();
    /* A shut spoiler shows its title and hides its body. */
    const shut = el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open;
    for (const child of el.childNodes) if (!shut || (child as Element).tagName === 'SUMMARY') walk(child);
    if (block) line();
  };
  walk(body);
  return out.trim();
}

/**
 * What the range quotes, or null when it is not a selection of one post's shown words: both ends in the same body (an end at the very start
 * of whatever follows the body, which is where a triple click on its last paragraph ends, counts as inside it), and some shown words between.
 */
export function readRange(range: Range): Selected | null {
  if (range.collapsed) return null;
  const from = bodyAt(range.startContainer);
  if (!from) return null;
  const to = bodyAt(range.endContainer);
  if (to ? to.body !== from.body : range.endOffset !== 0 || [...document.querySelectorAll<HTMLElement>(BODY)].some((b) => b !== from.body && range.intersectsNode(b))) return null;
  const text = shownWords(from.body, range);
  return text === '' ? null : { ...from, text };
}

/** Where the button stands: just under the selection's last line, at its end, in page coordinates. */
function placeFor(range: Range, body: HTMLElement): { readonly x: number; readonly y: number } {
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : undefined;
  const last = rects && rects.length > 0 ? rects[rects.length - 1]! : body.getBoundingClientRect();
  const wide = typeof window.innerWidth === 'number' && window.innerWidth > 0 ? window.innerWidth : last.right;
  return { x: Math.max(0, Math.min(last.right, wide - 120)) + window.scrollX, y: last.bottom + window.scrollY + 4 };
}

interface Offer { readonly act: Act; readonly text: string; readonly x: number; readonly y: number; readonly key: string }

export function SelectionQuote({ actOf, quote }: {
  /** The quotable Act of a post number on this page, if any. */
  readonly actOf: (seq: number) => Act | undefined;
  readonly quote: (act: Act, words: string) => void;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  /* The selection Esc or a click elsewhere put away: it stays away until the selection changes. */
  const dismissed = useRef<string | null>(null);
  /* A press on the button: some browsers collapse the selection as it lands, and the press must still find its words. */
  const pressing = useRef(false);

  useEffect(() => {
    const look = () => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const read = range ? readRange(range) : null;
      const act = read ? actOf(read.seq) : undefined;
      if (!range || !read || !act) {
        if (pressing.current) return;
        dismissed.current = null;
        setOffer(null);
        return;
      }
      const key = `${act.id}\n${read.text}`;
      if (dismissed.current === key) { setOffer(null); return; }
      setOffer((was) => (was && was.key === key ? was : { act, text: read.text, key, ...placeFor(range, read.body) }));
    };
    document.addEventListener('selectionchange', look);
    return () => document.removeEventListener('selectionchange', look);
  }, [actOf]);

  const key = offer?.key ?? null;
  useEffect(() => {
    if (key === null) return;
    const away = () => { dismissed.current = key; setOffer(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') away(); };
    const onPointer = (e: Event) => { if (!(e.target instanceof Element && e.target.closest('.kb-selection-quote'))) away(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer, true); };
  }, [key]);

  const press = useCallback(() => {
    if (!offer) return;
    pressing.current = false;
    quote(offer.act, offer.text);
    window.getSelection()?.removeAllRanges();
    setOffer(null);
  }, [offer, quote]);

  if (!offer) return null;
  return createPortal(
    <button
      type="button" className="kb-button kb-selection-quote" aria-label="Quote the selected text" data-kb-size="small" style={{ left: offer.x, top: offer.y }}
      onMouseDown={(e) => e.preventDefault()} onPointerDown={() => { pressing.current = true; }} onPointerUp={() => { pressing.current = false; }}
      onClick={press}
    >
      Quote
    </button>,
    document.body,
  );
}
