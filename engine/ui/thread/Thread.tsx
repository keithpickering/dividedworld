/**
 * A thread: its Acts in pages of `postsPerPage`, live.
 *
 * A page is a range of seqs (pages.ts), and an address is `?page=N#post-M` and nothing else: no
 * character, the HUD's included, is ever in it. "Continue to page N" reads the next page and puts
 * it below, in place, and the address follows without scrolling. A permalink to a post opens the
 * page it is on, at it; a page opened with no post asked opens at its top, and a page the reader
 * moves to opens at its first post. Reading is remembered on the server: the highest seq that has
 * come into view, sent debounced and never lower than what was sent (and never lower on the server either).
 *
 * Live (the thread's channel): on the last page with the reader at the bottom a new Act slides in
 * (not under reduced motion). Otherwise the page never moves by itself: a bar above the HUD says
 * how many are waiting ("3 new posts", or "3 new posts on page 7" from an earlier page) and shows
 * them when clicked, or when the reader gets to the bottom. Tallies and edits update in place. One
 * polite live region says "New post by <name>" once per new post, and nothing about a reaction or
 * an edit. The bar's way out: click it, or read on.
 *
 * Back from the glass (engine/ui/glass/back.ts) reopens the thread at the post the reader was at,
 * with what it showed and knew of then (in history.state, never the address): the posts that came
 * while the reader was away wait behind the same bar, as live posts do, and the reader is not moved.
 * Everything shown is read again, so a post edited or splatted meanwhile shows as it is now. The
 * thread says what it knows of (`data-kb-known`) so the move into the glass can keep it.
 *
 * The head is the Main board's: the title with the pages beside it, then the table's Author and
 * Message column head over side-by-side posts.
 *
 * Cost: a page is one read of the Acts, one each of its characters, stats, standings, reveals,
 * turns and tallies for the characters and Acts it holds, never one per post; a character that
 * first appears live costs the same, once. Tallies live in a keyed store, so a storm of them
 * re-renders the posts it lands on and not the page.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { billing, drawnOf } from '../cards/billing.ts';
import { createPlays, effectCards, readEffects, readPlays } from '../cards/plays.ts';
import { Composer, SystemBoardNote, type ComposerHandle } from '../composer/Composer.tsx';
import { useKayfa } from '../context.tsx';
import type { Act, Id, ThreadListener } from '../data/api.ts';
import { SignInPrompt, pageList, useSignedIn } from '../mini.tsx';
import { motionReduced } from '../appearance.ts';
import { usePlayer } from '../player.tsx';
import type { PostbitLayout, PostbitPerson } from '../postbit/Postbit.tsx';
import { reveals } from '../postbit/reveals.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { returnOf } from '../glass/back.ts';
import { emptyFeed, feedReducer, newer, ordered, shownEnd, waitingPosts } from './feed.ts';
import { ActIndex, actLoader, type Located } from './locate.tsx';
import { pageEndsThread, pageOf, pageRange, seqOfHash, threadHref } from './pages.ts';
import { ActArticle } from './Post.tsx';
import { ThreadCtx, type ThreadContext } from './context.ts';
import { text } from './lines.tsx';
import { createMine } from '../reactions/mine.ts';
import { primeSpun, spunCount } from '../spin/spun.ts';
import { createTallies } from './tallies.ts';
import './thread.css';

/** How long a reader's position settles before it is sent. */
export const READ_DEBOUNCE_MS = 400;
/** How long a live Act waits for the one before it before the gap is read from the server. */
export const GAP_FILL_MS = 1500;
/** The longest wait between two tries at reading a gap that will not fill. */
export const GAP_RETRY_MAX_MS = 30_000;
/** The announcer keeps the last few lines; a screen reader hears what is added. */
const ANNOUNCED = 4;

type Status = 'loading' | 'missing' | 'failed' | 'ready';

export function ThreadScreen({ thread }: { readonly thread: Id }) {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  if (signedIn === null) return <div className="kb-thread" aria-busy="true" />;
  if (!signedIn) return <div className="kb-thread"><SignInPrompt /></div>;
  return <ThreadView key={thread} thread={thread} />;
}

const keyOf = (l: { query: URLSearchParams; hash: string }) => `${l.query.toString() ? `?${l.query.toString()}` : ''}${l.hash ? `#${l.hash}` : ''}`;

function ThreadView({ thread }: { readonly thread: Id }) {
  const { api, settings, ui } = useKayfa();
  const P = settings.postsPerPage;
  const player = usePlayer();
  const navigate = useNavigate();
  const loc = useLocation();

  const [status, setStatus] = useState<Status>('loading');
  const [feed, dispatch] = useReducer(feedReducer, emptyFeed);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const [layout, setLayout] = useState<PostbitLayout>('side');
  const [busy, setBusy] = useState(false);
  const [atBottom, setAtBottom] = useState(() => typeof IntersectionObserver === 'undefined');
  const [lines, setLines] = useState<readonly { readonly key: number; readonly text: string }[]>([]);
  const tallies = useMemo(() => createTallies(), []);
  const mine = useMemo(() => createMine(), []);
  /* The card plays on the posts on screen (engine/ui/cards/plays.ts), and which cards the instance draws an effect for: only theirs have a state to read. */
  const plays = useMemo(() => createPlays(), []);
  const effects = useMemo(() => effectCards(ui), [ui]);
  /* Whether this is a thread of The System's board, where replies are spins and there is no reply box. */
  const [systemBoard, setSystemBoard] = useState<boolean | null>(null);
  /* The boards could not be read, so which kind of board this is is unknown: neither the reply box nor the System's note is shown. */
  const [boardUnread, setBoardUnread] = useState(false);
  const composer = useRef<ComposerHandle>(null);

  /* The player, read by callbacks that must not change when it does. */
  const hud = useRef<Id | null>(null);
  hud.current = player.hudCharacter?.id ?? null;
  const own = useRef<ReadonlySet<Id>>(new Set());
  own.current = new Set(player.characters.map((c) => c.id));
  const reactionLanded = useRef(player.reactionLanded);
  reactionLanded.current = player.reactionLanded;

  /* ------------------------------------------------------------------------ people ---- */
  const people = useRef(new Map<Id, PostbitPerson>());
  const asked = useRef(new Map<Id, Promise<void>>());
  const [, bump] = useState(0);
  const ensurePeople = useCallback(async (ids: readonly (Id | null)[]): Promise<void> => {
    const wanted = [...new Set(ids.filter((c): c is Id => c !== null))];
    const need = wanted.filter((id) => !asked.current.has(id));
    if (need.length > 0) {
      const batch = (async () => {
        const [chars, stats, standings, revealed, turns] = await Promise.all([
          api.characters(need), api.characterStats(need), api.standingAmounts(need), api.classReveals(need), api.turnsAnnounced(need),
        ]);
        const said = reveals(revealed, turns);
        for (const c of chars) {
          const statement = said.get(c.id);
          people.current.set(c.id, {
            character: c, posts: stats[c.id]?.posts ?? 0, standing: standings[c.id] ?? null,
            revealed: statement?.revealed ?? null, turnedAt: statement?.turnedAt ?? null,
          });
        }
        bump((n) => n + 1);
      })().catch(() => { /* a character that could not be read shows as "A character"; the post is not lost */ });
      for (const id of need) asked.current.set(id, batch);
    }
    await Promise.all(wanted.map((id) => asked.current.get(id)));
  }, [api]);

  /* A character's name as the thread knows it: read before the posts that name it are drawn. */
  const nameOf = useCallback((id: Id | null) => (id === null ? 'The System' : people.current.get(id)?.character.name ?? 'A character'), []);

  /*
   * The posts of a read, with the plays on them, their tallies, the player's own reactions and the threads spun from
   * them, ready to show. A play is an Act like a post: its tally and the player's reactions to it join the posts' in
   * one read each, and its spins go through the line's batched read, never one per post or per play. Each post's plays
   * are then billed (cards/billing.ts), once for this read: a live count moves no tag.
   */
  const prepare = useCallback(async (acts: readonly Act[]) => {
    await ensurePeople(acts.map((a) => a.character));
    if (acts.length > 0) {
      /* Every play on the page's posts in one read; a play takes no number, so it is found through its post. */
      const posts = acts.filter((a) => a.kind === 'post').map((a) => a.id);
      const played = await readPlays(api, plays, posts, effects);
      const ids = [...acts.map((a) => a.id), ...played.map((a) => a.id)];
      const [counted, own, spun] = await Promise.all([
        api.tallies(ids),
        /* The player's own reactions: if they cannot be read the server still refuses a repeat, in its words. */
        api.myReactions(ids).catch(() => []),
        primeSpun(api, ids),
        /* A play's caster is named before it is drawn. */
        ensurePeople(played.map((a) => a.character)),
      ]);
      for (const [id, t] of Object.entries(counted)) tallies.merge(id, t);
      for (const id of ids) mine.merge(id, own.filter((r) => r.act === id));
      for (const post of posts) {
        const here = plays.get(post).plays;
        if (here.length === 0) continue;
        plays.setBilling(post, billing(here, (play) => drawnOf(tallies.get(play), spunCount(spun.get(play)!))).map((p) => p.id));
      }
    }
  }, [api, ensurePeople, tallies, mine, plays, effects]);

  /* ----------------------------------------------------------------- where to scroll ---- */
  const scrollTo = useRef<{ readonly seq: number; readonly scroll: boolean; readonly focus: boolean } | null>(null);
  /* An address this screen wrote itself: the location effect leaves it alone. */
  const selfNav = useRef<string | null>(null);
  const goal = useRef<{ page: number | null; seq: number | null }>({
    page: Number.parseInt(loc.query.get('page') ?? '', 10) || null,
    seq: seqOfHash(loc.hash),
  });
  const [loadKey, setLoadKey] = useState(0);
  /* Set once the first read has landed: a later one is the reader's own move, and focus follows it. */
  const reloaded = useRef(false);
  /* What the thread showed and knew of when the reader left for the glass, when Back brought them here; the first read only. */
  const back = useRef(returnOf(loc.state));

  /* ---------------------------------------------------------------------- reading ---- */
  const sent = useRef(0);
  const seen = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (seen.current > sent.current) {
      const was = sent.current;
      sent.current = seen.current;
      /* A read that could not be sent (the reader signed out, the network went) is not sent: the next position, or this one again, is. */
      const at = seen.current;
      const unsent = () => { if (sent.current === at) sent.current = was; };
      Promise.resolve(api.markRead(thread, at, hud.current)).then((ok) => { if (!ok) unsent(); }, unsent);
    }
  }, [api, thread]);
  const [observer] = useState<IntersectionObserver | null>(() => {
    if (typeof IntersectionObserver === 'undefined') return null;
    return new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const seq = Number((e.target as HTMLElement).dataset.kbSeq);
        if (Number.isFinite(seq) && seq > seen.current) seen.current = seq;
      }
      if (seen.current > sent.current && !timer.current) timer.current = setTimeout(flush, READ_DEBOUNCE_MS);
    });
  });
  useEffect(() => () => { flush(); observer?.disconnect(); }, [flush, observer]);

  /* The bottom: a sentinel below the last post says whether the reader is there. */
  const [bottomObserver] = useState<IntersectionObserver | null>(() => {
    if (typeof IntersectionObserver === 'undefined') return null;
    return new IntersectionObserver((entries) => {
      for (const e of entries) setAtBottom(e.isIntersecting);
    }, { rootMargin: '0px 0px 120px 0px' });
  });
  const endRef = useCallback((el: HTMLDivElement | null) => {
    if (!bottomObserver) return;
    bottomObserver.disconnect();
    if (el) bottomObserver.observe(el);
  }, [bottomObserver]);
  useEffect(() => () => bottomObserver?.disconnect(), [bottomObserver]);

  /* -------------------------------------------------------------------------- load ---- */
  useEffect(() => {
    let live = true;
    setBusy(true);
    void (async () => {
      const summary = await api.thread(thread);
      if (!live) return;
      if (!summary) { setStatus('missing'); return; }
      const last = pageOf(summary.lastSeq, P);
      const wanted = goal.current.seq !== null ? pageOf(goal.current.seq, P) : goal.current.page ?? 1;
      const page = Math.min(Math.max(1, wanted), last);
      const { start, end } = pageRange(page, P);
      const [acts, reading, prefs, board] = await Promise.all([api.acts(thread, start, end), api.reading([thread]), api.preferences(), api.board(summary.board).catch(() => null)]);
      await prepare(acts);
      if (!live) return;
      sent.current = Math.max(sent.current, reading[thread] ?? 0);
      setLayout(prefs.postbit);
      /* Known before the first post is drawn, so the reply box and the posts' Quote links do not change the page after it. */
      setSystemBoard(board ? board.isSystem : null);
      setBoardUnread(!board);
      const ends = pageEndsThread(acts.length, { start, end }, summary.lastSeq);
      dispatch({ type: 'loaded', summary, firstPage: page, lastPage: page, acts, tailLoaded: ends, through: ends ? summary.lastSeq : end, back: reloaded.current ? null : back.current });
      setStatus('ready');
      const seq = goal.current.seq !== null && goal.current.seq <= summary.lastSeq ? goal.current.seq : null;
      /* The canonical address of where this landed: the page, and the post when one was asked for. */
      const to_ = threadHref(thread, page, seq ?? undefined);
      selfNav.current = to_.slice(to_.indexOf('?'));
      navigate(to_, { replace: true });
      /* A page opened with no post asked stays at its top, where its title and pages are; a later read is the reader's move, and lands at it. */
      scrollTo.current = { seq: seq ?? start, scroll: seq !== null || reloaded.current, focus: seq !== null || reloaded.current };
      reloaded.current = true;
    })().catch(() => { if (live) setStatus((s) => (s === 'ready' ? s : 'failed')); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new read is asked for by loadKey; the rest are stable for the thread
  }, [api, thread, loadKey]);

  /* The address changed by the reader (a link, back, a pager): show it, reading more only when it is not on screen. */
  useEffect(() => {
    const f = feedRef.current;
    if (!f.ready) return;
    const key = keyOf(loc);
    if (selfNav.current === key) { selfNav.current = null; return; }
    const seq = seqOfHash(loc.hash);
    const page = seq !== null ? pageOf(seq, P) : Number.parseInt(loc.query.get('page') ?? '', 10) || 1;
    const loaded = page >= f.firstPage && page <= f.lastPage && (seq === null || [...f.shown.values()].some((a) => a.seq === seq));
    if (loaded) {
      scrollTo.current = { seq: seq ?? Math.max(pageRange(page, P).start, ordered(f.shown)[0]?.seq ?? 1), scroll: true, focus: seq !== null };
      bump((n) => n + 1);
      return;
    }
    goal.current = { page, seq };
    setLoadKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the address only
  }, [loc]);

  /* After a render that has what the reader asked to see: scroll to it. Never smooth: an address is a jump. */
  useEffect(() => {
    const want = scrollTo.current;
    if (!want) return;
    const el = document.getElementById(`post-${want.seq}`);
    if (!el) return;
    scrollTo.current = null;
    if (want.scroll) el.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    if (want.focus) el.focus({ preventScroll: true });
  });

  /* ---------------------------------------------------------------------- the pages ---- */
  const more = useRef(false);
  const continueTo = useCallback(async () => {
    const f = feedRef.current;
    if (more.current || f.tailLoaded) return;
    more.current = true;
    setBusy(true);
    try {
      const page = f.lastPage + 1;
      const { start, end } = pageRange(page, P);
      const acts = await api.acts(thread, start, end);
      await prepare(acts);
      /* Posts held behind a return's bar that the run now passes come in before the page read. What
         is shown and held is read as it stands after the read, not as it stood when the reader asked. */
      const now = feedRef.current;
      const from = shownEnd(now) + 1;
      const heldNext = [...now.held.values()].some((a) => a.seq === from);
      const ends = pageEndsThread(acts.length, { start, end }, f.serverLast);
      dispatch({ type: 'more', page, acts, tailLoaded: ends, through: ends ? f.serverLast : end });
      const href = threadHref(thread, page);
      selfNav.current = href.slice(href.indexOf('?'));
      navigate(href, { replace: true });
      /* Focus moves to the first new post and nothing scrolls: it is just below what the reader had. */
      const first = heldNext ? from : acts[0]?.seq;
      if (first != null) scrollTo.current = { seq: first, scroll: false, focus: true };
      /* Nothing more after all: the link that had focus is gone, so focus stays with the last post. */
      else { const last = ordered(feedRef.current.shown).at(-1)?.seq; if (last != null) scrollTo.current = { seq: last, scroll: false, focus: true }; }
    } catch {
      /* The link is still there to try again. */
    } finally {
      more.current = false;
      setBusy(false);
    }
  }, [api, thread, P, prepare, navigate]);

  /* ----------------------------------------------------------------------- live ---- */
  const announcedIds = useRef(new Set<Id>());
  /* Acts whose characters are being read, with the latest version of each that has arrived since. */
  const inflight = useRef(new Map<Id, Act>());
  const lineKey = useRef(0);
  useEffect(() => {
    const announce = (a: Act) => {
      /* New posts only: an unmask or a tally still appears, and is not announced. */
      if (a.kind !== 'post' || announcedIds.current.has(a.id)) return;
      announcedIds.current.add(a.id);
      const name = a.character === null ? 'The System' : people.current.get(a.character)?.character.name ?? 'a character';
      setLines((l) => [...l, { key: ++lineKey.current, text: `New post by ${name}` }].slice(-ANNOUNCED));
    };
    const listener: ThreadListener = {
      onAct(a) {
        /* A card play is a tag on its post, never a place in the thread: it is added to the post it names, wherever that post is, once its caster is known. */
        if (a.kind === 'card') {
          void ensurePeople([a.character]).then(() => { plays.add([a]); return readEffects(api, plays, [a], effects); });
          return;
        }
        const f = feedRef.current;
        if (f.shown.has(a.id) || f.held.has(a.id)) { dispatch({ type: 'live', act: a }); return; }
        if (a.seq === null) return;
        if (f.ready && a.seq <= f.baseEnd) return;
        const pending = inflight.current.get(a.id);
        if (pending) { inflight.current.set(a.id, newer(pending, a)); return; }
        inflight.current.set(a.id, a);
        void ensurePeople([a.character]).then(() => {
          const latest = inflight.current.get(a.id)!;
          inflight.current.delete(a.id);
          dispatch({ type: 'live', act: latest });
          if (feedRef.current.ready) announce(latest);
        });
      },
      onEffect(play) {
        /* A saved state is read where it is kept, by the play it names: the post author's newest version is what every reader loads. */
        void api.effectStates([play]).then((saved) => plays.setStates(saved), () => { /* the next save is heard again */ });
      },
      onTally(act, t) {
        const grew = tallies.merge(act, t);
        if (!grew) return;
        const f = feedRef.current;
        const here = f.shown.get(act) ?? f.held.get(act);
        const landed = (character: Id | null) => { if (character !== null && own.current.has(character)) reactionLanded.current(); };
        if (here) { landed(here.character); return; }
        /* An Act on another page: who wrote it is read through the batching, bounded loader shared with the quotes. */
        void actLoader(api).ask(act).then((x) => landed(x?.character ?? null));
      },
    };
    return api.subscribeThread(thread, listener);
  }, [api, thread, ensurePeople, tallies, plays, effects]);

  /* At the bottom of the last page, held Acts come in, sliding. */
  useEffect(() => {
    if (feed.ready && atBottom && feed.tailLoaded && feed.held.size > 0) dispatch({ type: 'release', slide: !motionReduced(), force: false });
  }, [feed, atBottom]);

  /* A gap that does not fill (a broadcast that never came) is read from the server. The effect depends
     on where the gap starts and nothing that a live Act changes, so a busy thread does not restart its
     timer with every Act; where it ends is read when it fires. */
  const gapStart = useMemo(() => {
    if (!feed.ready || !feed.tailLoaded || feed.held.size === 0) return null;
    const first = ordered(feed.held)[0]!.seq!;
    const end = shownEnd(feed);
    return first > end + 1 ? end + 1 : null;
  }, [feed]);
  /* Which gap has waited its time: only then does the bar offer the held posts, so an Act a moment ahead of its predecessor does not flash it. */
  const [gapWaited, setGapWaited] = useState<number | null>(null);
  const readGap = useCallback(async (start: number) => {
    const acts = await api.acts(thread, start, feedRef.current.knownLast);
    await prepare(acts);
    dispatch({ type: 'fill', acts });
  }, [api, thread, prepare]);
  useEffect(() => {
    if (gapStart === null) { setGapWaited(null); return; }
    let live = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      setGapWaited(gapStart);
      /* Whether it failed or came back short, ask again later and less often; leaving or filling the gap ends it. */
      readGap(gapStart).catch(() => { /* asked again below */ }).finally(() => {
        if (!live) return;
        tries += 1;
        timer = setTimeout(attempt, Math.min(GAP_FILL_MS * 2 ** (tries - 1), GAP_RETRY_MAX_MS));
      });
    };
    timer = setTimeout(attempt, GAP_FILL_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [gapStart, readGap]);

  /* ---------------------------------------------------------------- derived things ---- */
  const index = useCallback((id: Id): Located | undefined => {
    const a = feedRef.current.shown.get(id) ?? feedRef.current.held.get(id);
    return a && a.seq !== null ? { thread: a.thread, seq: a.seq } : undefined;
  }, []);
  const quote = useCallback((a: Act) => composer.current?.quote(a.id, text(a.currentPayload.body)), []);
  const changed = useCallback((a: Act) => dispatch({ type: 'live', act: a }), []);
  const canReply = systemBoard === false;
  const context = useMemo<ThreadContext | null>(
    () => (feed.summary ? { thread, perPage: P, summary: feed.summary, tallies, mine, plays, nameOf, know: ensurePeople, observer, quote: canReply ? quote : null, changed } : null),
    [thread, P, feed.summary, tallies, mine, plays, nameOf, ensurePeople, observer, canReply, quote, changed],
  );
  const shown = useMemo(() => ordered(feed.shown), [feed.shown]);

  /* The last post shown, to quote from the toolbar (the thread's latest only when its tail is on screen). */
  const latest = useMemo(() => {
    for (let i = shown.length - 1; i >= 0; i--) {
      const a = shown[i]!;
      if (a.kind === 'post' || a.kind === 'spin') return { id: a.id, body: text(a.currentPayload.body) };
    }
    return null;
  }, [shown]);

  /* A reply the player just made: shown at once at the foot, or, when the foot is not loaded, opened at its page. Focus goes to it and the polite region says so. */
  const posted = async (a: Act) => {
    announcedIds.current.add(a.id);
    setLines((l) => [...l, { key: ++lineKey.current, text: 'Reply posted' }].slice(-ANNOUNCED));
    try { await ensurePeople([a.character]); } catch { /* shown as "A character"; the post is not lost */ }
    dispatch({ type: 'live', act: a });
    if (a.seq !== null) scrollTo.current = { seq: a.seq, scroll: false, focus: true };
    if (feedRef.current.tailLoaded) dispatch({ type: 'release', slide: !motionReduced(), force: true });
    else if (a.seq !== null) navigate(threadHref(thread, pageOf(a.seq, P), a.seq));
  };
  /* Which kind of board this is, read again after it could not be. */
  const readBoard = async () => {
    try {
      const boardId = feedRef.current.summary?.board;
      const board = boardId ? await api.board(boardId) : null;
      setSystemBoard(board ? board.isSystem : null);
      setBoardUnread(!board);
    } catch { setBoardUnread(true); }
  };

  /* The bar's way out: read what is missing before the held posts if there is a gap (and show them anyway if it cannot be read). */
  const showHeld = async () => {
    const f = feedRef.current;
    let first = ordered(f.held)[0]?.seq ?? null;
    if (gapStart !== null) {
      try { await readGap(gapStart); first = gapStart; } catch { /* shown as they are; a reload reads the rest */ }
    }
    dispatch({ type: 'release', slide: false, force: true });
    if (first !== null) scrollTo.current = { seq: first, scroll: true, focus: false };
  };

  /* ------------------------------------------------------------------------- render ---- */
  if (status === 'loading') return <div className="kb-thread" aria-busy="true" />;
  if (status === 'failed') return <div className="kb-thread"><p className="kb-notice" data-kb-tone="refusal">The thread could not be loaded. Reload the page to try again.</p></div>;
  if (status === 'missing' || !context || !feed.summary) {
    return (
      <div className="kb-thread">
        <h1 className="kb-heading">No such thread</h1>
        <p>There is no such thread. <Link to="/">Back to the index</Link>.</p>
      </div>
    );
  }

  const summary = feed.summary;
  const lastPage = pageOf(feed.knownLast, P);
  const waiting = waitingPosts(feed);
  let bar: { readonly href: string | null; readonly text: string } | null = null;
  /* Whenever posts are held and the screen is not about to show them by itself: at the bottom with no gap it does, and after a gap has waited its time it does not. */
  const comesByItself = atBottom && feed.tailLoaded && (gapStart === null || gapWaited !== gapStart);
  if (waiting && !comesByItself) {
    const noun = `${waiting.count} new ${waiting.count === 1 ? 'post' : 'posts'}`;
    if (feed.tailLoaded) bar = { href: null, text: noun };
    else {
      /* On an earlier page: say which page the new posts are on, and lead there. */
      const lo = pageOf(waiting.first, P);
      const hi = pageOf(waiting.last, P);
      bar = { href: threadHref(thread, lo, waiting.first), text: `${noun} on ${hi === lo ? `page ${lo}` : `pages ${lo} to ${hi}`}` };
    }
  }

  const pager = (where: 'top' | 'bottom') => lastPage > 1 && (
    <nav className="kb-pager kb-small" aria-label={`Pages, ${where}`}>
      <span className="kb-pager-where">{feed.lastPage > feed.firstPage ? `Pages ${feed.firstPage} to ${feed.lastPage}` : `Page ${feed.firstPage}`} of {lastPage}</span>
      {pageList(feed.firstPage, lastPage).map((p, i) => p === null
        ? <span key={`gap${i}`} aria-hidden="true">…</span>
        : p === feed.firstPage && feed.lastPage === feed.firstPage
          ? <span key={p} className="kb-pager-here" aria-current="page">{p}</span>
          : <Link key={p} to={threadHref(thread, p)} aria-label={`Page ${p}`}>{p}</Link>)}
      <Link to={threadHref(thread, lastPage, feed.knownLast)} onClick={() => dispatch({ type: 'release', slide: false, force: true })}>Jump to latest</Link>
    </nav>
  );

  return (
    <div className="kb-thread" data-kb-thread={thread} data-kb-known={feed.knownLast} aria-busy={busy || undefined}>
      <p className="kb-crumb"><Link to="/">Index</Link> › {summary.title}</p>
      <div className="kb-thread-head">
        <h1 className="kb-heading kb-thread-title">{summary.title}</h1>
        {pager('top')}
      </div>
      <ActIndex.Provider value={index}>
        <ThreadCtx.Provider value={context}>
          <div className="kb-acts">
            {/* The 2003 table's column head, over side-by-side posts; each article names its own author for a screen reader. */}
            {layout === 'side' && (
              <div className="kb-acts-head" aria-hidden="true">
                <span>Author</span>
                <span>Message</span>
              </div>
            )}
            {shown.map((a) => <ActArticle key={a.id} act={a} person={a.character ? people.current.get(a.character) : undefined} layout={layout} slid={feed.slid.has(a.id)} />)}
          </div>
        </ThreadCtx.Provider>
      </ActIndex.Provider>
      <div ref={endRef} className="kb-thread-end" data-kb-end="" aria-hidden="true" />
      {!feed.tailLoaded && (
        <p className="kb-thread-continue">
          <Link
            to={threadHref(thread, feed.lastPage + 1)}
            onClick={(e) => { e.preventDefault(); void continueTo(); }}
          >Continue to page {feed.lastPage + 1}</Link>
        </p>
      )}
      {pager('bottom')}
      {systemBoard !== null && (
        <ActIndex.Provider value={index}>
          <ThreadCtx.Provider value={context}>
            {systemBoard ? <SystemBoardNote /> : <Composer ref={composer} thread={thread} latest={latest} since={() => feedRef.current.knownLast} onPosted={(a) => void posted(a)} />}
          </ThreadCtx.Provider>
        </ActIndex.Provider>
      )}
      {systemBoard === null && boardUnread && (
        <p className="kb-composer-note kb-notice" data-kb-tone="refusal">
          The board this thread is on could not be read, so the reply box is left out. <button type="button" className="kb-link-button" onClick={() => void readBoard()}>Try again</button>
        </p>
      )}
      <div className="kb-visually-hidden" role="status" aria-live="polite" aria-atomic="false">
        {lines.map((l) => <p key={l.key}>{l.text}</p>)}
      </div>
      {bar && (
        <div className="kb-new-bar">
          {bar.href
            ? <Link className="kb-button" data-kb-primary="" to={bar.href}>{bar.text}</Link>
            : <button type="button" className="kb-button" data-kb-primary="" onClick={() => void showHeld()}>{bar.text}</button>}
        </div>
      )}
    </div>
  );
}
