/**
 * Autocorrect's effect on a post (docs/plans/2026-11-03-autocorrect-design.md; plan Task 6): a strip of label tape over every
 * occurrence of each play's phrase in the post's own words, bearing the caster's replacement, that any reader can peel.
 *
 * Where the strips go. The post stays the board's 2003 post; the strips are laid over its words through the renderer's text
 * layers (engine/ui/bbcode/layers.tsx), at offsets into its visible text, which the card's rules read on the server through the
 * same matcher (match.ts), so a strip lies on exactly the words the play was priced for. A strip is drawn as one piece over its
 * whole occurrence even where the words cross formatting, and the words under it are kept there, hidden, so the tape takes the
 * width of the wider of the two (the owner's note on #150). A strip of more than LONG characters is tape that breaks across lines
 * and takes the replacement's width, as the design leaves to the owner's eye on the shots. Strips follow the phrase: each version
 * of the post is matched again, so one edited away goes and one written in comes.
 *
 * Stacking. The later play is stuck over the earlier: where live strips overlap, only the top one shows, over all they cover
 * together, and peeling it shows the one beneath (peel.ts `stripsOf`).
 *
 * Peeling. A drag past twice the strip's height peels it, and a shorter one lets it settle back; a key held for the card's
 * `peelMs` (`cardSettings['autocorrect.peelMs']`) peels it too, and letting go early lets it settle back, so the keyboard's way
 * costs what a drag does ("An accessible path costs what the obstacle costs"). A peeled strip leaves an adhesive band over the
 * author's words, in their own formatting, and a copy of it falls away (fall.ts), or fades where it was under reduced motion.
 *
 * Whose peels. A reader's are kept in this component only, so a reload brings the tape back. The post's author's are also saved
 * through `save`, by place in this version of the post ("the second Mario"), and every reader loads them; a save that got no
 * answer is sent again after a backoff, and a refusal is said and the strip comes back. Peels are kept by place, so an edit that
 * writes the phrase in earlier in the post moves which occurrence a saved peel names; that is the design's choice.
 *
 * Screen readers. A strip is a button named "Autocorrected text: “Luigi”. Hold Enter or Space to peel", and the words under it
 * are hidden from them as from the eye; once peeled, the author's words are read as any words are, and the status region says
 * what was under it. A strip peeled while focused hands focus to the next strip on the post, or to the post itself, so a
 * keyboard reader keeps their place. A peel the author made just before leaving the post is still sent.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { LOST_ANSWER, type Answer } from '../../../../engine/ui/data/api.ts';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { seeded } from '../../ui/seeded.ts';
import { dropStrip, type Corner } from './fall.ts';
import { dragPeels, holdShare, savedAfterPeel, stripsOf, type PlayStrips, type Strip } from './peel.ts';
import './autocorrect.css';

/**
 * The tape's paper, its typing, and the paper shaded as a held key peels it, the same on either board: a piece of the game, so
 * it keeps its own colors. They reach the stylesheet as custom properties on each strip (the falling copy keeps them too).
 */
export const TAPE = Object.freeze({ paper: '#f4f0e4', ink: '#17150f', held: '#d2cec4' });
/** A strip longer than this many characters breaks across lines as tape, rather than standing as one block. */
const LONG = 28;
const DEFAULT_PEEL_MS = 700;
const SAVE_AFTER_MS = 400;
const RETRY_AFTER_MS = 1500;
const MAX_SAVE_RETRIES = 3;

/** The places a saved state names as peeled; anything else is none. */
const savedPeels = (state: unknown): number[] => {
  const peeled = (state as { peeled?: unknown } | null | undefined)?.peeled;
  return Array.isArray(peeled) ? peeled.filter((n): n is number => Number.isSafeInteger(n) && n >= 0) : [];
};

interface StripProps {
  readonly strip: Strip;
  readonly covered: string;
  readonly peelMs: number;
  readonly onPeel: (strip: Strip, el: HTMLElement, corner: Corner, covered: string) => void;
  readonly onMeet: () => void;
}

/** One strip of tape: a button that comes away when pulled far enough, or when a key is held long enough. */
function StripButton({ strip, covered, peelMs, onPeel, onMeet }: StripProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const held = useRef<{ timer: ReturnType<typeof setTimeout>; tick: ReturnType<typeof setInterval>; at: number } | null>(null);
  const [pull, setPull] = useState<{ dx: number; dy: number } | null>(null);
  const [share, setShare] = useState(0);
  const tilt = useMemo(() => ((seeded(strip.key)() - 0.5) * 2.4).toFixed(2), [strip.key]);
  const long = Math.max([...covered].length, [...strip.replacement].length) > LONG;

  const letGo = useCallback(() => {
    if (held.current) { clearTimeout(held.current.timer); clearInterval(held.current.tick); held.current = null; }
    setShare(0);
  }, []);
  useEffect(() => letGo, [letGo]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (e.repeat || held.current) return;
    onMeet();
    const at = Date.now();
    held.current = {
      at,
      tick: setInterval(() => setShare(holdShare(Date.now() - at, peelMs)), 50),
      timer: setTimeout(() => { letGo(); if (ref.current) onPeel(strip, ref.current, 'right', covered); }, peelMs),
    };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    /* Only the main button pulls tape; a right or middle click is the browser's. */
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    onMeet();
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setPull({ dx: e.clientX - drag.current.x, dy: e.clientY - drag.current.y });
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.id !== e.pointerId) return;
    drag.current = null;
    setPull(null);
    const [dx, dy] = [e.clientX - start.x, e.clientY - start.y];
    const height = ref.current?.getBoundingClientRect().height || 16;
    if (e.type === 'pointerup' && dragPeels(dx, dy, height) && ref.current) onPeel(strip, ref.current, dx < 0 ? 'left' : 'right', covered);
  };

  const style = {
    '--dw-ac-paper': TAPE.paper,
    '--dw-ac-ink': TAPE.ink,
    '--dw-ac-held': TAPE.held,
    '--dw-ac-tilt': `${tilt}deg`,
    '--dw-ac-hold': share.toFixed(2),
    ...(pull ? { '--dw-ac-pull-x': `${(pull.dx * 0.35).toFixed(1)}px`, '--dw-ac-pull-y': `${(pull.dy * 0.35).toFixed(1)}px`, '--dw-ac-lift': `${Math.min(1, Math.hypot(pull.dx, pull.dy) / 60).toFixed(2)}` } : null),
  } as CSSProperties;
  return (
    <button
      ref={ref} type="button" className={`dw-ac-strip${long ? ' dw-ac-long' : ''}`} style={style}
      data-kb-strip={strip.key} data-kb-pulling={pull ? 'true' : undefined} data-kb-holding={share > 0 ? 'true' : undefined}
      aria-label={`Autocorrected text: “${strip.replacement}”. Hold Enter or Space to peel`}
      onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') letGo(); }} onBlur={letGo}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
    >
      {!long && <span className="dw-ac-covered" aria-hidden="true">{covered}</span>}
      <span className="dw-ac-said" aria-hidden="true">{strip.replacement}</span>
    </button>
  );
}

export function AutocorrectEffect({ post, plays, states, reader, save, show, met, children }: EffectProps) {
  const { settings } = useKayfa();
  const peelMs = settings.cardSettings['autocorrect.peelMs'] ?? DEFAULT_PEEL_MS;
  const reduced = useMotionReduced();
  const body = typeof post.currentPayload.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  /* This reader's own peels, by strip key, never sent; and the author's peels on their way to being saved, by play. */
  const [local, setLocal] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState<Readonly<Record<string, readonly number[]>>>({});
  /* A refused save's words, by play, and what the last peel uncovered, for the status region a screen reader hears. */
  const [refusals, setRefusals] = useState<Readonly<Record<string, string>>>({});
  const [uncovered, setUncovered] = useState('');
  const report = Object.values(refusals).filter(Boolean).join(' ');
  const box = useRef<HTMLDivElement>(null);

  const configs = useMemo(() => plays.flatMap((p) => {
    const { phrase, replacement } = p.config as { phrase?: unknown; replacement?: unknown };
    return !p.caught && typeof phrase === 'string' && typeof replacement === 'string' ? [{ id: p.id, phrase, replacement }] : [];
  }), [plays]);
  const playStrips = useMemo<PlayStrips[]>(() => configs.map((c) => ({
    ...c, peeled: new Set([...savedPeels(states[c.id]?.state), ...(sending[c.id] ?? [])]),
  })), [configs, states, sending]);
  const { shown, peeled, total } = useMemo(() => stripsOf(text, playStrips, local), [text, playStrips, local]);

  /*
   * The author's peels, saved as Whoops!'s strokes are: debounced, one save on its way per play at a time, what is peeled meanwhile
   * sent after it, a save that got no answer sent again a little later each time and given up on after a few, and a refusal said,
   * with its strips put back, since it would be the same again. Each save is the whole list of places, so sending it twice is the
   * same as once.
   */
  const now = useRef({ states, total, save, sending });
  now.current = { states, total, save, sending };
  const inFlight = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /* Once the post has gone nothing is set and nothing retried, as Whoops! does; a peel still waiting on its debounce is sent at once. */
  const gone = useRef(false);
  const flush = useCallback(async (play: string, attempt = 0): Promise<void> => {
    if (inFlight.current.has(play)) { dirty.current.add(play); return; }
    dirty.current.delete(play);
    timers.current.delete(play);
    const batch = [...(now.current.sending[play] ?? [])];
    const places = [...savedPeels(now.current.states[play]?.state), ...batch];
    if (!places.length) return;
    const state = savedAfterPeel(places, places[places.length - 1]!, now.current.total[play] ?? 0);
    inFlight.current.add(play);
    let answer: Answer<unknown>;
    try {
      answer = await now.current.save(play, state);
    } catch {
      answer = { ok: false, error: LOST_ANSWER, uncertain: true };
    }
    inFlight.current.delete(play);
    if (answer.ok) {
      if (!gone.current) setRefusals((was) => (was[play] ? { ...was, [play]: '' } : was));
      if (dirty.current.has(play)) await flush(play);
      return;
    }
    if (gone.current) return;
    if (answer.uncertain && attempt < MAX_SAVE_RETRIES) {
      timers.current.set(play, setTimeout(() => { void flush(play, attempt + 1); }, RETRY_AFTER_MS * 2 ** attempt));
      return;
    }
    dirty.current.delete(play);
    setRefusals((was) => ({ ...was, [play]: answer.error }));
    /* Only the places this save carried come back; any peeled since wait for their own. */
    setSending((was) => {
      const left = (was[play] ?? []).filter((i) => !batch.includes(i));
      const next = { ...was, [play]: left };
      now.current.sending = next;
      return next;
    });
  }, []);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const waiting = [...timers.current.entries()];
      timers.current.clear();
      for (const [play, t] of waiting) { clearTimeout(t); void flush(play); }
    };
  }, [flush]);
  const queue = useCallback((play: string) => {
    const was = timers.current.get(play);
    if (was) clearTimeout(was);
    timers.current.set(play, setTimeout(() => { void flush(play); }, SAVE_AFTER_MS));
  }, [flush]);

  const meet = useRef(met);
  meet.current = met;
  const onMeet = useCallback(() => meet.current(), []);
  const onPeel = useCallback((strip: Strip, el: HTMLElement, corner: Corner, covered: string) => {
    /* A strip peeled while focused takes the reader's place with it: focus goes to the next strip on the post, or to the post. */
    if (el === document.activeElement) {
      const strips = [...(box.current?.querySelectorAll<HTMLElement>('.dw-ac-strip') ?? [])];
      const next = strips[strips.indexOf(el) + 1] ?? box.current;
      next?.focus();
    }
    /* Said again when the same words are uncovered twice: a no-break space every other time makes it new text, as Whoops! does. */
    setUncovered((was) => { const said = `Peeled. Under it: “${covered}”.`; return was === said ? `${said}\u00a0` : said; });
    dropStrip(el, { corner, reduced, seed: strip.key });
    if (reader.author) {
      setSending((was) => {
        const next = { ...was, [strip.play]: [...(was[strip.play] ?? []), strip.index] };
        now.current.sending = next;
        return next;
      });
      queue(strip.play);
    } else {
      setLocal((was) => new Set([...was, strip.key]));
    }
  }, [reader.author, reduced, queue]);

  const runs = useMemo<TextRun[]>(() => [
    ...peeled.map((s): TextRun => ({
      from: s.from, to: s.to, key: `a:${s.key}`, z: s.z, mode: 'wrap',
      render: ({ text: words, key }) => <span key={key} className="dw-ac-adhesive" data-kb-peeled={s.key}>{words}</span>,
    })),
    ...shown.map((s): TextRun => ({
      from: s.from, to: s.to, key: s.key, z: s.z, mode: 'replace',
      render: ({ text: covered, key }) => <StripButton key={key} strip={s} covered={covered} peelMs={peelMs} onPeel={onPeel} onMeet={onMeet} />,
    })),
  ], [shown, peeled, peelMs, onPeel, onMeet]);

  /* The Lens's words: how many strips this post shows, how many are peeled, and each play's phrase and places. */
  const all = shown.length + peeled.length;
  const view: CardView = {
    progress: all ? peeled.length / all : null,
    state: all ? `${all} ${all === 1 ? 'strip' : 'strips'}, ${peeled.length} peeled` : 'Its phrase is not in this version of the post',
    ends: 'Peel a strip to read what is under it',
    yours: reader.author && shown.length > 0,
    controls: [],
    notes: Object.fromEntries(configs.map((c) => [c.id, `“${c.phrase}” → “${c.replacement}”, ${total[c.id] ?? 0} ${(total[c.id] ?? 0) === 1 ? 'place' : 'places'}`])),
    ...(report ? { report } : null),
  };
  const viewKey = JSON.stringify(view);
  const viewNow = useRef(view);
  viewNow.current = view;
  useEffect(() => { show(viewNow.current); }, [viewKey, show]);

  return (
    <div ref={box} className="dw-ac" data-kb-autocorrect="" tabIndex={-1}>
      <TextLayer runs={runs}>{children}</TextLayer>
      <p className="kb-visually-hidden" role="status" data-kb-report>{report || uncovered}</p>
    </div>
  );
}
