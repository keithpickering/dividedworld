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
 * are hidden from them as from the eye; once peeled, the author's words are read as any words are.
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

/** The tape's paper and its typing, the same on either board: a piece of the game, so it keeps its own colors. */
export const TAPE = Object.freeze({ paper: '#f4f0e4', ink: '#17150f' });
/** A strip longer than this many characters breaks across lines as tape, rather than standing as one block. */
const LONG = 28;
const DEFAULT_PEEL_MS = 700;
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
  readonly onPeel: (strip: Strip, el: HTMLElement, corner: Corner) => void;
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
      timer: setTimeout(() => { letGo(); if (ref.current) onPeel(strip, ref.current, 'right'); }, peelMs),
    };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
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
    if (e.type === 'pointerup' && dragPeels(dx, dy, height) && ref.current) onPeel(strip, ref.current, dx < 0 ? 'left' : 'right');
  };

  const style = {
    '--dw-ac-tilt': `${tilt}deg`,
    '--dw-ac-hold': share.toFixed(2),
    ...(pull ? { '--dw-ac-pull-x': `${(pull.dx * 0.35).toFixed(1)}px`, '--dw-ac-pull-y': `${(pull.dy * 0.35).toFixed(1)}px`, '--dw-ac-lift': `${Math.min(1, Math.hypot(pull.dx, pull.dy) / 60).toFixed(2)}` } : null),
  } as CSSProperties;
  return (
    <button
      ref={ref} type="button" className={`dw-ac-strip${long ? ' dw-ac-long' : ''}`} style={style}
      data-kb-strip={strip.key} data-kb-pulling={pull ? 'true' : undefined} data-kb-holding={share > 0 ? 'true' : undefined}
      aria-label={`Autocorrected text: “${strip.replacement}”. Hold Enter or Space to peel`}
      onKeyDown={onKeyDown} onKeyUp={letGo} onBlur={letGo}
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
  const [report, setReport] = useState('');

  const configs = useMemo(() => plays.flatMap((p) => {
    const { phrase, replacement } = p.config as { phrase?: unknown; replacement?: unknown };
    return !p.caught && typeof phrase === 'string' && typeof replacement === 'string' ? [{ id: p.id, phrase, replacement }] : [];
  }), [plays]);
  const playStrips = useMemo<PlayStrips[]>(() => configs.map((c) => ({
    ...c, peeled: new Set([...savedPeels(states[c.id]?.state), ...(sending[c.id] ?? [])]),
  })), [configs, states, sending]);
  const { shown, peeled, total } = useMemo(() => stripsOf(text, playStrips, local), [text, playStrips, local]);

  /* What the author's peel saves: everything saved and on its way for that play, with this place; a lost answer is sent again. */
  const now = useRef({ states, total, save, sending });
  now.current = { states, total, save, sending };
  const send = useCallback(async (play: string, attempt = 0) => {
    const places = [...savedPeels(now.current.states[play]?.state), ...(now.current.sending[play] ?? [])];
    const last = places.at(-1) ?? 0;
    const state = savedAfterPeel(places, last, now.current.total[play] ?? 0);
    let answer: Answer<unknown>;
    try {
      answer = await now.current.save(play, state);
    } catch {
      answer = { ok: false, error: LOST_ANSWER, uncertain: true };
    }
    if (answer.ok) { setReport(''); return; }
    if (answer.uncertain && attempt < MAX_SAVE_RETRIES) { setTimeout(() => { void send(play, attempt + 1); }, RETRY_AFTER_MS * 2 ** attempt); return; }
    setReport(answer.error);
    setSending((was) => { const { [play]: _, ...rest } = was; return rest; });
  }, []);

  const meet = useRef(met);
  meet.current = met;
  const onMeet = useCallback(() => meet.current(), []);
  const onPeel = useCallback((strip: Strip, el: HTMLElement, corner: Corner) => {
    dropStrip(el, { corner, reduced, seed: strip.key });
    if (reader.author) {
      setSending((was) => {
        const next = { ...was, [strip.play]: [...(was[strip.play] ?? []), strip.index] };
        now.current.sending = next;
        return next;
      });
      void send(strip.play);
    } else {
      setLocal((was) => new Set([...was, strip.key]));
    }
  }, [reader.author, reduced, send]);

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
    <div className="dw-ac" data-kb-autocorrect="">
      <TextLayer runs={runs}>{children}</TextLayer>
      <p className="kb-visually-hidden" role="status" data-kb-report>{report}</p>
    </div>
  );
}
