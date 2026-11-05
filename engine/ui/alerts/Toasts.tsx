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
 * While the hand is open (`hold`) the column is hidden, the hand fans through the same corner; the toasts stay where they are in the live region, so
 * closing the hand does not draw them again, and their clocks stand still, so each keeps the time it had left and nothing is lost to the hand.
 *
 * What a screen reader is told is a region of its own, always drawn and visually hidden (a polite status), apart from the visual list: each toast is
 * announced once, as "line. detail", when it becomes visible. That is on arrival, or for one that arrived while the hand was open, when the hand closes.
 * Each announcement leaves the region after a couple of seconds, so it does not grow. A toast is a nudge, never a state: it names its way out (its dismiss button, or it fades by
 * itself) and everything it said is on the Alerts page. Only the kinds the player keeps on toast (toast-kinds.ts); every alert still counts.
 *
 * What a toast says is read for the alert alone: the Act it names and the Act that names, the thread's title and the character's public name, all public
 * reads, and a read that fails leaves the plain words ("your post was quoted") and a toast all the same.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useKayfa } from '../context.tsx';
import type { Act, Alert, Id, KayfaApi } from '../data/api.ts';
import { useMotionReduced } from '../appearance.ts';
import { Link } from '../router.tsx';
import { AlertIcon } from './AlertIcon.tsx';
import { useToastKinds } from './toast-kinds.ts';
import { remember, type Arrival } from './useAlertFeed.ts';
import { plainText, wordsFor, type Way, type WordsContext } from './words.ts';
import './toasts.css';

/** How many show at once, and how long each stays (unpaused). */
export const TOASTS_SHOWN = 3;
export const TOAST_MS = 6000;
/** How long an announcement stays in the status region. */
export const SAID_MS = 2500;

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
  const names = new Map<Id, string>();
  let row: Alert = { kind: a.kind, sub: a.sub, act: a.act, character: a.character, at: a.at, thread: null, name: null, title: null, count: a.count ?? null };
  try {
    if (a.kind === 'update' && a.act !== null) {
      const update = (await api.updates()).find((u) => u.act === a.act);
      if (update) row = { ...row, name: update.name, title: update.title };
    } else if (a.act !== null && a.kind !== 'seasonNews') {
      const named = await api.actsById([a.act]);
      for (const x of named) acts.set(x.id, x);
      const play = acts.get(a.act);
      /* A card an admin ended is the card_end, then the play, then the post it landed on and that post's author. */
      const ofEnd = a.kind === 'cardEnded' && play?.targetActId ? play.targetActId : null;
      if (ofEnd) for (const x of await api.actsById([ofEnd])) acts.set(x.id, x);
      const ended = ofEnd ? acts.get(ofEnd) : undefined;
      if (ended?.targetActId) for (const x of await api.actsById([ended.targetActId])) acts.set(x.id, x);
      const author = ended?.targetActId ? acts.get(ended.targetActId)?.character : null;
      if (author) for (const c of await api.characters([author]).catch(() => [])) names.set(c.id, c.name);
      const target = play?.kind === 'card' && play.targetActId ? play.targetActId : null;
      if (target) for (const x of await api.actsById([target])) acts.set(x.id, x);
      const about = (target ? acts.get(target) : undefined) ?? play;
      const [title, who] = await Promise.all([
        about ? api.thread(about.thread).then((t) => t?.title ?? null, () => null) : null,
        a.character ? api.characters([a.character]).then((cs) => cs[0]?.name ?? null, () => null) : null,
      ]);
      row = { ...row, thread: about?.thread ?? null, title, name: who };
    } else if (a.kind === 'settlement') {
      /* Its row is the player's own and says all it needs. */
    } else if (a.character !== null) {
      row = { ...row, name: (await api.characters([a.character]))[0]?.name ?? null };
    }
  } catch { /* the plain words stand */ }
  return { row, ctx: { ...base, acts, names, reading: null, startedBy: new Map(), newestSettlement: null } };
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
      remember(taken.current, a.id);
      if (!choice.current(a.kind)) continue;
      const mine = ++order.current;
      void read(api, a, { instance, ui, perPage: settings.postsPerPage }).then(({ row, ctx }) => {
        if (!live.current) return;
        const said = wordsFor(row, ctx);
        const toast: Toast = { id: a.id, order: mine, kind: a.kind, line: plainText(said.line), detail: plainText(said.detail), way: said.ways[0] ?? null, at: a.at };
        left.current.set(toast.id, settings.toastMs ?? TOAST_MS);
        setQueue((q) => (q.some((t) => t.id === toast.id) ? q : [...q, toast].sort((x, y) => x.order - y.order)));
      });
    }
  }, [arrivals, api, instance, ui, settings.postsPerPage, settings.toastMs]);

  /* A dropped toast leaves the map, so its card's cleanup does not write it back. */
  const drop = useCallback((id: string) => { left.current.delete(id); setQueue((q) => q.filter((t) => t.id !== id)); }, []);

  /* The toast that had focus is going: focus goes to a neighbor's dismiss button, else where the caller says. */
  const back = useRef(returnFocus);
  back.current = returnFocus;
  const dismiss = useCallback((id: string, card: HTMLElement | null) => {
    if (card?.contains(document.activeElement)) {
      const next = (card.nextElementSibling ?? card.previousElementSibling)?.querySelector<HTMLElement>('.kb-toast-x') ?? null;
      if (next) next.focus(); else back.current?.();
    }
    drop(id);
  }, [drop]);

  const shown = queue.slice(0, TOASTS_SHOWN);
  const more = queue.length - shown.length;

  /* Each toast that has become visible is said once. */
  const [said, setSaid] = useState<readonly { readonly id: string; readonly text: string }[]>([]);
  const told = useRef(new Set<string>());
  const clears = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (hold) return;
    const fresh = shown.filter((t) => !told.current.has(t.id));
    if (fresh.length === 0) return;
    for (const t of fresh) remember(told.current, t.id);
    const entries = fresh.map((t) => ({ id: t.id, text: t.detail === '' ? t.line : `${t.line}. ${t.detail}` }));
    setSaid((now) => [...now, ...entries]);
    const timer = setTimeout(() => {
      clears.current.delete(timer);
      setSaid((now) => now.filter((e) => !entries.some((x) => x.id === e.id)));
    }, SAID_MS);
    clears.current.add(timer);
  }, [hold, shown]);
  useEffect(() => () => { for (const t of clears.current) clearTimeout(t); }, []);

  return (
    <>
      <div className="kb-visually-hidden" role="status" aria-live="polite" aria-label="New alerts">
        {said.map((e) => <p key={e.id}>{e.text}</p>)}
      </div>
      <div ref={column} className="kb-toasts">
      <div className="kb-toasts-list" hidden={hold}>
        {more > 0 && (
          <Link to="/alerts" className="kb-toasts-more kb-glass-skew" aria-label={`+${more} more alerts`} onClick={() => { setQueue([]); left.current.clear(); }}>
            <span className="kb-glass-upright">+{more} more</span>
          </Link>
        )}
        <AnimatePresence initial={false}>
          {shown.map((t) => (
            <Card key={t.id} toast={t} reduced={reduced} held={hold} left={left.current} onDismiss={dismiss} onGone={drop} />
          ))}
        </AnimatePresence>
      </div>
      </div>
    </>
  );
}

interface CardProps {
  readonly toast: Toast;
  readonly reduced: boolean;
  /** The hand is open: the clock stands still. */
  readonly held: boolean;
  readonly left: Map<string, number>;
  readonly onDismiss: (id: string, card: HTMLElement | null) => void;
  readonly onGone: (id: string) => void;
}

function Card({ toast, reduced, held, left, onDismiss, onGone }: CardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const el = useRef<HTMLElement>(null);
  const lineId = `kb-toast-${toast.id}`;
  /* A card on its way out (dismissed, its exit playing) has no clock either. */
  const present = useIsPresent();
  const paused = hovered || focused || held || !present;

  /* The clock runs while neither pointer nor focus is on the toast, and what it had left is kept when it stops or the toast is taken off for the hand. */
  useEffect(() => {
    if (paused) return undefined;
    const remaining = left.get(toast.id);
    if (remaining === undefined) return undefined;
    const started = Date.now();
    const t = setTimeout(() => onGone(toast.id), remaining);
    return () => { clearTimeout(t); if (left.has(toast.id)) left.set(toast.id, Math.max(0, remaining - (Date.now() - started))); };
  }, [paused, toast.id, left, onGone]);

  const props = {
    ref: el,
    className: 'kb-toast kb-glass-cut',
    'data-kb-kind': toast.kind,
    'aria-labelledby': lineId,
    /* Only a mouse holds a toast by hovering: a tap on a touch screen is not a pointer resting on it. */
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => { if (e.pointerType === 'mouse') setHovered(true); },
    onPointerLeave: () => setHovered(false),
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
