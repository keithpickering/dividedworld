/**
 * The toasts (the alerts plan, Task 10; the alerts design, section 8; boards docs/research/2026-11-02-alerts/01-board-toasts.html and 05-phone.html): a
 * column above the HUD's seam, rising from Alerts, of the alerts that arrived live while the player is on the board. At most three show, oldest first
 * (the next rises as one goes); the rest fold into "+N more", which opens Alerts. Each holds its kind's icon in its ink, the line (the words of the Alerts
 * row, words.ts, so a toast and its row say the same thing), one link, when it arrived and a dismiss button.
 *
 * It stays about six seconds, and the clock stops while the pointer is on it or focus is in it: the time it had left is what it keeps. Motion slides
 * and fades it; under reduced motion it appears and leaves without moving at all (a plain element, no transform). The column is a polite live region
 * that is there before anything arrives, so each toast is announced as it is added.
 *
 * While the hand is open (`hold`) nothing is drawn, the hand fans through the same corner; toasts that arrived wait, and those on screen keep the time
 * they had left, and all of them rise when the hand closes. A toast is a nudge, never a state: it names its way out (its dismiss button, or it fades by
 * itself) and everything it said is on the Alerts page. Only the kinds the player keeps on toast (toast-kinds.ts); every alert still counts.
 *
 * What a toast says is read for the alert alone: the Act it names and the Act that names, the thread's title and the character's public name, all public
 * reads, and a read that fails leaves the plain words ("your post was quoted") and a toast all the same.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKayfa } from '../context.tsx';
import type { Act, Alert, Id, KayfaApi } from '../data/api.ts';
import { useMotionReduced } from '../appearance.ts';
import { Link } from '../router.tsx';
import { AlertIcon } from './AlertIcon.tsx';
import { useToastKinds } from './toast-kinds.ts';
import type { Arrival } from './useAlertFeed.ts';
import { plainText, wordsFor, type Way, type WordsContext } from './words.ts';
import './toasts.css';

/** How many show at once, and how long each stays (unpaused). */
export const TOASTS_SHOWN = 3;
export const TOAST_MS = 6000;

interface Toast {
  readonly id: string;
  readonly order: number;
  readonly kind: Arrival['kind'];
  readonly line: string;
  readonly detail: string;
  readonly way: Way | null;
  readonly at: string;
}

/** How long ago, in the toast's own short words. */
export function ago(at: string, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(at)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'now';
  return minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d`;
}

/** The row an arrival is, with what the words need beside it, read as far as can be. */
async function read(api: KayfaApi, a: Arrival, base: Pick<WordsContext, 'instance' | 'ui' | 'perPage'>): Promise<{ row: Alert; ctx: WordsContext }> {
  const acts = new Map<Id, Act>();
  let row: Alert = { kind: a.kind, sub: a.sub, act: a.act, character: a.character, at: a.at, thread: null, name: null, title: null, count: null };
  try {
    if (a.kind === 'update' && a.act !== null) {
      const update = (await api.updates()).find((u) => u.act === a.act);
      if (update) row = { ...row, name: update.name, title: update.title };
    } else if (a.act !== null && a.kind !== 'seasonNews') {
      const named = await api.actsById([a.act]);
      for (const x of named) acts.set(x.id, x);
      const play = acts.get(a.act);
      const target = play?.kind === 'card' && play.targetActId ? play.targetActId : null;
      if (target) for (const x of await api.actsById([target])) acts.set(x.id, x);
      const about = (target ? acts.get(target) : undefined) ?? play;
      const [title, who] = await Promise.all([
        about ? api.thread(about.thread).then((t) => t?.title ?? null, () => null) : null,
        a.character ? api.characters([a.character]).then((cs) => cs[0]?.name ?? null, () => null) : null,
      ]);
      row = { ...row, thread: about?.thread ?? null, title, name: who };
    } else if (a.character !== null) {
      row = { ...row, name: (await api.characters([a.character]))[0]?.name ?? null };
    }
  } catch { /* the plain words stand */ }
  return { row, ctx: { ...base, acts, reading: null, startedBy: new Map(), newestSettlement: null } };
}

export interface ToastsProps {
  /** Every arrival heard so far (useAlertFeed), in order. */
  readonly arrivals: readonly Arrival[];
  /** True while the hand is open: nothing is drawn, and the time each toast had left is kept. */
  readonly hold: boolean;
  /** Where focus goes when the toast that had it goes and no other toast is left (the HUD's Alerts button). */
  readonly returnFocus?: () => void;
}

export function Toasts({ arrivals, hold, returnFocus }: ToastsProps) {
  const { api, instance, ui, settings } = useKayfa();
  const keepsOnToast = useToastKinds();
  const reduced = useMotionReduced();
  const [queue, setQueue] = useState<readonly Toast[]>([]);
  const taken = useRef(new Set<string>());
  const order = useRef(0);
  /* The time each toast has left, kept across a hold; a ref, since only the toast's own timer writes it. */
  const left = useRef(new Map<string, number>());
  const column = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  const choice = useRef(keepsOnToast);
  choice.current = keepsOnToast;

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  useEffect(() => {
    for (const a of arrivals) {
      if (taken.current.has(a.id)) continue;
      taken.current.add(a.id);
      if (!choice.current(a.kind)) continue;
      const mine = ++order.current;
      void read(api, a, { instance, ui, perPage: settings.postsPerPage }).then(({ row, ctx }) => {
        if (!live.current) return;
        const said = wordsFor(row, ctx);
        const toast: Toast = { id: a.id, order: mine, kind: a.kind, line: plainText(said.line), detail: plainText(said.detail), way: said.ways[0] ?? null, at: a.at };
        setQueue((q) => (q.some((t) => t.id === toast.id) ? q : [...q, toast].sort((x, y) => x.order - y.order)));
      });
    }
  }, [arrivals, api, instance, ui, settings.postsPerPage]);

  const drop = (id: string) => { left.current.delete(id); setQueue((q) => q.filter((t) => t.id !== id)); };

  /* The toast that had focus is going: focus goes to a neighbor's dismiss button, else where the caller says. */
  const dismiss = (id: string, card: HTMLElement | null) => {
    if (card?.contains(document.activeElement)) {
      const next = (card.nextElementSibling ?? card.previousElementSibling)?.querySelector<HTMLElement>('.kb-toast-x') ?? null;
      if (next) next.focus(); else returnFocus?.();
    }
    drop(id);
  };

  const shown = hold ? [] : queue.slice(0, TOASTS_SHOWN);
  const more = hold ? 0 : queue.length - shown.length;

  return (
    <div ref={column} className="kb-toasts" role="status" aria-live="polite" aria-relevant="additions" aria-label="New alerts">
      {more > 0 && (
        <Link to="/alerts" className="kb-toasts-more kb-glass-skew" onClick={() => { setQueue([]); left.current.clear(); }}>
          <span className="kb-glass-upright">+{more} more</span>
        </Link>
      )}
      <AnimatePresence initial={false}>
        {shown.map((t) => (
          <Card key={t.id} toast={t} reduced={reduced} left={left.current} onDismiss={dismiss} onGone={drop} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface CardProps {
  readonly toast: Toast;
  readonly reduced: boolean;
  readonly left: Map<string, number>;
  readonly onDismiss: (id: string, card: HTMLElement | null) => void;
  readonly onGone: (id: string) => void;
}

function Card({ toast, reduced, left, onDismiss, onGone }: CardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const el = useRef<HTMLElement>(null);
  const lineId = `kb-toast-${toast.id}`;
  const paused = hovered || focused;

  /* The clock runs while neither pointer nor focus is on the toast, and what it had left is kept when it stops or the toast is taken off for the hand. */
  useEffect(() => {
    if (paused) return undefined;
    const remaining = left.get(toast.id) ?? TOAST_MS;
    const started = Date.now();
    const t = setTimeout(() => onGone(toast.id), remaining);
    return () => { clearTimeout(t); left.set(toast.id, Math.max(0, remaining - (Date.now() - started))); };
  }, [paused, toast.id, left, onGone]);

  const props = {
    ref: el,
    className: 'kb-toast kb-glass-cut',
    'data-kb-kind': toast.kind,
    'aria-labelledby': lineId,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (e: React.FocusEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); },
  };
  const body = (
    <>
      <AlertIcon kind={toast.kind} className="kb-toast-ico" />
      <p className="kb-toast-said">
        <b id={lineId} className="kb-toast-line">{toast.line}</b>
        {toast.detail !== '' && <span className="kb-toast-detail">{toast.detail}</span>}
        {toast.way && <Link to={toast.way.to} state={toast.way.state} className="kb-toast-way" onClick={() => onDismiss(toast.id, null)}>{toast.way.text}</Link>}
      </p>
      <div className="kb-toast-side">
        <time dateTime={toast.at} className="kb-num">{ago(toast.at)}</time>
        <button type="button" className="kb-toast-x" aria-label="Dismiss" aria-describedby={lineId} onClick={() => onDismiss(toast.id, el.current)}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="16" height="16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </>
  );
  /* Reduced motion: a plain element, appearing and leaving where it stands. */
  if (reduced) return <article {...props}>{body}</article>;
  return (
    <motion.article
      {...props}
      layout="position"
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      {body}
    </motion.article>
  );
}
