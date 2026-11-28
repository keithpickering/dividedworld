/**
 * Console Slog's effect on a post (docs/plans/2026-11-27-season-two-cards-design.md, section 3; plan Task 8): the post's content area is an empty command
 * prompt, a black ground with green Courier, scanlines over it, a prompt line (`C:\DW\POSTS> type 4471.txt`, the post's number) and a block cursor, and a
 * reader mashes keys, or taps, to type the post out. The post's words are not drawn while it holds the reader: the terminal prints them from the post's
 * parsed BBCode (slog.ts), a character at a time, and an image loads in green phosphor a band a press.
 * An image's box is laid out at its full height from the first press, hidden with the untyped text, and revealed band by band, so the post does not grow mid-mash.
 *
 * The box. The terminal fills the post's content area border to border (CLAUDE.md, "An effect fills the post, border to border"): two layers, a ground under
 * the words and the scanlines over them, are placed over the area `bodyOf` finds and `bodyBox` measures, in a thread and in a spun thread's ORIGIN box alike
 * (each is that box's own area), and over the host where there is no area (a moment, History). The words are the terminal's own text, in the flow, so the
 * post has its height from the first press: what has not been typed is laid out hidden after the cursor, so no line breaks later than it will when it has typed.
 *
 * The mash. A press is a fresh key press (the browser's repeats of a held key are ignored), a tap or a click on the terminal, or an assistive technology's
 * activation of the button. Only typing keys press (a character, Enter, Backspace): modifiers, shortcuts, function keys, arrows, paging, Escape, Tab (the way out of it) and a composing key are left alone. A steady rhythm makes each press worth more (slog.ts). The
 * same for every reader, the post's author and the caster among them: "An accessible path costs what the obstacle costs", so the accessible path is the same
 * mash (a key, a tap or a switch press each reveal the same), and reduced motion changes only the cursor, which holds still, and never what a press costs.
 *
 * What is kept. The count of units out is the reader's own, in their browser (`readerMemory`, engine/ui/cards/reader-memory.ts), keyed by the play. An edit
 * keeps it, trimmed to the new length. The last unit out releases the reader (`EffectProps.release`), on every device, and a released reader sees the
 * post as written (`children`). A release that did not land is tried again on the next press, so the reader is never stuck at the end.
 *
 * Screen readers. The prompt line is the button, named "Console Slog: press any key or tap to type out this post", and the typed text is plain text in the
 * page after it, so what has been typed can be read; a press is announced by nothing, since a character a press would be too much to say. A link is a link
 * once all of its text and address are out, and its dead form is plain text. Only a writing card reads `still` (types.ts), so this one never does: History draws no
 * terminal. In a play's moment the reader is nobody: the count is the screen's own, kept in no memory, and nothing is released.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { bodyBox, bodyOf, placeLayer, sameBox, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import { readerMemory } from '../../../../engine/ui/cards/reader-memory.ts';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { nextStreak, pressWorth, unitsOf, type SlogSettings, type Unit } from './slog.ts';
import './slog.css';

/** The settings' own numbers, used where the screen settings do not hold one (the instance's `cardSettings`). */
const DEFAULTS: SlogSettings = { rhythmMs: 450, perStep: 5, mostPerPress: 8, drain: 12, bands: 16 };
const NAME = 'Console Slog: press any key or tap to type out this post';
const ENDS = 'Ends when you type out the whole post.';

/** What a reader keeps for a play: how many of its units are out. */
const kept = (raw: unknown): { readonly shown: number } | null => {
  const shown = typeof raw === 'object' && raw !== null ? (raw as { shown?: unknown }).shown : undefined;
  return typeof shown === 'number' && Number.isSafeInteger(shown) && shown >= 0 ? { shown } : null;
};

/** What the first `to` units draw: text, a link (live once all of it is out) and an image's box with the bands out so far. */
function draw(units: readonly Unit[], to: number): ReactNode[] {
  const out: ReactNode[] = [];
  let text = '';
  const flush = (): void => { if (text !== '') { out.push(text); text = ''; } };
  let i = 0;
  while (i < to) {
    const u = units[i]!;
    if (u.kind === 'band') {
      flush();
      /* One image's bands are consecutive and count up from 0, so another image of the same address starts at band 0 again. */
      let end = i + 1;
      while (end < to && units[end]!.kind === 'band' && (units[end] as { band: number }).band === (units[end - 1] as { band: number }).band + 1) end++;
      const bandsOut = end - i;
      out.push(
        <span key={`i${i}`} className="dw-slog-image" data-kb-slog-image="" data-kb-bands-out={bandsOut}>
          <img src={u.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          <span className="dw-slog-mask" style={{ top: `${(bandsOut / u.bands) * 100}%` }} />
        </span>,
      );
      i = end;
      continue;
    }
    if (u.link !== undefined) {
      flush();
      let all = i;
      while (all < units.length && (units[all] as { link?: number }).link === u.link) all++;
      const own = units.slice(i, Math.min(all, to));
      const words = own.filter((x) => x.kind === 'char' && x.part === 'text').map((x) => (x as { ch: string }).ch).join('');
      const address = own.filter((x) => x.kind === 'char' && x.part === 'address').map((x) => (x as { ch: string }).ch).join('');
      out.push(
        all <= to
          ? <a key={`l${i}`} className="dw-slog-link" href={u.href} target="_blank" rel="noopener noreferrer">{words}</a>
          : <span key={`l${i}`} className="dw-slog-dead">{words}</span>,
        address,
      );
      i = Math.min(all, to);
      continue;
    }
    text += u.ch;
    i++;
  }
  flush();
  return out;
}

/** What is not out yet, laid out hidden in its place: its text, and each image that has not begun as a box at full height with no band showing. */
function drawRest(units: readonly Unit[], from: number): ReactNode[] {
  const out: ReactNode[] = [];
  let text = '';
  for (let i = from; i < units.length; i++) {
    const u = units[i]!;
    if (u.kind === 'char') { text += u.ch; continue; }
    /* An image that began before `from` has its box drawn with the words that are out; its other bands add nothing. */
    if (i > 0 && units[i - 1]!.kind === 'band' && (units[i - 1] as { band: number }).band + 1 === u.band) continue;
    if (i === from && u.band > 0) continue;
    if (text !== '') { out.push(text); text = ''; }
    out.push(
      <span key={`r${i}`} className="dw-slog-image" data-kb-slog-image="" data-kb-bands-out={0}>
        <img src={u.src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        <span className="dw-slog-mask" style={{ top: '0%' }} />
      </span>,
    );
  }
  if (text !== '') out.push(text);
  return out;
}

export function ConsoleSlogEffect({ post, plays, released, reader, moment, show, met, release, children }: EffectProps) {
  const { settings } = useKayfa();
  const slog: SlogSettings = {
    rhythmMs: settings.cardSettings['consoleSlog.rhythmMs'] ?? DEFAULTS.rhythmMs,
    perStep: settings.cardSettings['consoleSlog.perStep'] ?? DEFAULTS.perStep,
    mostPerPress: settings.cardSettings['consoleSlog.mostPerPress'] ?? DEFAULTS.mostPerPress,
    drain: settings.cardSettings['consoleSlog.drain'] ?? DEFAULTS.drain,
    bands: settings.cardSettings['consoleSlog.bands'] ?? DEFAULTS.bands,
  };
  const playId = plays[0]?.id ?? '';
  const body = typeof post.currentPayload.body === 'string' ? post.currentPayload.body : '';
  const units = useMemo(() => unitsOf(parse(body), slog.bands), [body, slog.bands]);
  const total = units.length;
  const live = moment === null;
  /* The reader's own place: in the browser's memory on a live post, and the screen's alone in a moment. */
  const memory = useMemo(() => (live && playId !== '' ? readerMemory(playId, kept) : null), [live, playId]);

  const [out, setOut] = useState(() => Math.min(total, memory?.get()?.shown ?? 0));
  const outRef = useRef(out);
  outRef.current = out;
  const streak = useRef(0);
  const last = useRef<number | null>(null);
  const releasing = useRef(false);
  const shown = Math.min(out, total);
  const done = total > 0 && shown >= total;
  const free = released.has(playId);

  /* An edit that shortens the post trims the count; the memory keeps what is out. */
  useEffect(() => { if (out > total) setOut(total); }, [out, total]);
  useEffect(() => { if (live && out <= total) memory?.set({ shown: out }); }, [live, memory, out, total]);

  const letGo = useCallback((): void => {
    if (!live || releasing.current || free) return;
    releasing.current = true;
    void release(playId).then((answer) => { if (!answer.ok) releasing.current = false; }, () => { releasing.current = false; });
  }, [live, free, release, playId]);
  /* The last unit out releases the reader; one that did not land is tried again on the next press (`press`). */
  useEffect(() => { if (done) letGo(); }, [done, letGo]);

  const press = useCallback((): void => {
    const now = Date.now();
    streak.current = nextStreak(streak.current, last.current === null ? Infinity : now - last.current, slog);
    last.current = now;
    const was = Math.min(outRef.current, total);
    if (was >= total) { letGo(); return; }
    const next = Math.min(total, was + pressWorth(streak.current, slog));
    outRef.current = next;
    setOut(next);
  }, [total, slog.rhythmMs, slog.perStep, slog.mostPerPress, slog.drain, letGo]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The Lens: how far the reader has got, and the one way out. */
  useEffect(() => {
    if (free || total === 0) return;
    const view: CardView = { progress: total === 0 ? null : shown / total, state: done ? 'Typed out for you' : `${shown} of ${total} typed for you`, ends: ENDS, yours: !done, controls: [], notes: {} };
    show(view);
  }, [show, shown, total, done, free]);
  useEffect(() => () => show(null), [show]);
  const met1 = useRef(false);
  useEffect(() => { if (moment !== null || met1.current || free) return; met1.current = true; met(); }, [met, moment, free]);

  /* The two layers, over the content area (or the host where there is none): the ground under the words, the scanlines over them. */
  const host = useRef<HTMLDivElement>(null);
  const ground = useRef<HTMLDivElement>(null);
  const scan = useRef<HTMLDivElement>(null);
  const drawn = !free && total > 0;
  useLayoutEffect(() => {
    const el = host.current;
    if (!drawn || !el) return;
    let area: HTMLElement | null = null;
    let placed: BodyBox | null = null;
    const measure = (): void => {
      const now = bodyOf(el);
      if (now !== area) {
        if (area) resize?.unobserve(area);
        if (now) resize?.observe(now);
        area = now;
        el.toggleAttribute('data-kb-bleed', area !== null);
      }
      const box = bodyBox(el, area);
      if (placed && sameBox(box, placed)) return;
      placed = box;
      for (const layer of [ground.current, scan.current]) if (layer) placeLayer(layer, box);
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(el);
    measure();
    return () => { resize?.disconnect(); el.removeAttribute('data-kb-bleed'); };
  }, [drawn]);

  const bar = useRef<HTMLDivElement>(null);
  if (free || total === 0) return <>{children}</>;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing || e.key === 'Process') return;
    /* Only typing keys press: a character (Space among them), Enter and Backspace. Function keys, arrows, paging, Escape and Tab keep doing what they do. */
    if (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace') return;
    /* A live link is a link: Enter follows it. */
    if (e.target instanceof Element && e.target.closest('a') !== null) return;
    e.preventDefault();
    press();
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('a') !== null) return;
    bar.current?.focus({ preventScroll: true });
    press();
  };
  /* An assistive technology's activation arrives as a click with no pointer before it (detail 0); a real click's press was its pointer's. */
  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.detail !== 0) return;
    if (e.target instanceof Element && e.target.closest('a') !== null) return;
    press();
  };

  return (
    <div ref={host} className="dw-slog" data-kb-slog="">
      <div ref={ground} className="dw-slog-ground" aria-hidden="true" />
      <div className="dw-slog-term" data-kb-slog-term="" onKeyDown={onKeyDown} onPointerDown={onPointerDown} onClick={onClick}>
        <div ref={bar} className="dw-slog-bar" role="button" tabIndex={0} aria-label={NAME}>{`C:\\DW\\POSTS> type ${post.seq ?? 'post'}.txt`}</div>
        <pre className="dw-slog-out" data-kb-slog-out="">
          <span data-kb-slog-shown="">{draw(units, shown)}</span>
          <span className="dw-slog-cursor" data-kb-cursor="" aria-hidden="true" {...(done ? { 'data-kb-still': '' } : {})} />
          <span className="dw-slog-rest" data-kb-slog-rest="" aria-hidden="true">{drawRest(units, shown)}</span>
        </pre>
      </div>
      <div ref={scan} className="dw-slog-scan" aria-hidden="true" />
    </div>
  );
}
