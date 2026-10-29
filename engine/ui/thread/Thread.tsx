/**
 * A thread: its Acts in pages of `postsPerPage`, live.
 *
 * A page is a range of seqs (pages.ts), and an address is `?page=N#post-M` and nothing else: no
 * character, the HUD's included, is ever in it. "Continue to page N" reads the next page and puts
 * it below, in place, and the address follows without scrolling. A permalink to a post opens the
 * page it is on, at it. Reading is remembered on the server: the highest seq that has come into
 * view, sent debounced and never lower than what was sent (and never lower on the server either).
 *
 * Live (the thread's channel): on the last page with the reader at the bottom a new Act slides in
 * (not under reduced motion). Otherwise the page never moves by itself: a bar above the HUD says
 * how many are waiting ("3 new posts", or "3 new posts on page 7" from an earlier page) and shows
 * them when clicked, or when the reader gets to the bottom. Tallies and edits update in place. One
 * polite live region says "New post by <name>" once per new post, and nothing about a reaction or
 * an edit. The bar's way out: click it, or read on.
 *
 * Cost: a page is one read of the Acts, one each of its characters, stats, standings, reveals,
 * turns and tallies for the characters and Acts it holds, never one per post; a character that
 * first appears live costs the same, once. Tallies live in a keyed store, so a storm of them
 * re-renders the posts it lands on and not the page.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, ThreadListener } from '../data/api.ts';
import { Ago, SignInPrompt, pageList, useSignedIn } from '../mini.tsx';
import { motionReduced } from '../appearance.ts';
import { usePlayer } from '../player.tsx';
import type { PostbitLayout, PostbitPerson } from '../postbit/Postbit.tsx';
import { reveals } from '../postbit/reveals.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { emptyFeed, feedReducer, ordered, shownEnd } from './feed.ts';
import { ActIndex, type Located } from './locate.tsx';
import { pageOf, pageRange, seqOfHash, threadHref } from './pages.ts';
import { ActArticle, ThreadCtx, type ThreadContext } from './Post.tsx';
import { createTallies } from './tallies.ts';
import './thread.css';

/** How long a reader's position settles before it is sent. */
export const READ_DEBOUNCE_MS = 400;
/** How long a live Act waits for the one before it before the gap is read from the server. */
export const GAP_FILL_MS = 1500;
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
  const { api, settings } = useKayfa();
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
          api.characters(need), api.characterStats(need), api.standingsOf(need), api.classReveals(need), api.turnsAnnounced(need),
        ]);
        const said = reveals(revealed, turns);
        for (const c of chars) {
          const statement = said.get(c.id);
          people.current.set(c.id, {
            character: c, posts: stats[c.id]?.posts ?? 0, standing: standings.find((s) => s.character === c.id)?.standing ?? null,
            revealed: statement?.revealed ?? null, turnedAt: statement?.turnedAt ?? null,
          });
        }
        bump((n) => n + 1);
      })().catch(() => { /* a character that could not be read shows as "A character"; the post is not lost */ });
      for (const id of need) asked.current.set(id, batch);
    }
    await Promise.all(wanted.map((id) => asked.current.get(id)));
  }, [api]);

  /* The posts of a read, with their tallies, ready to show. */
  const prepare = useCallback(async (acts: readonly Act[]) => {
    await ensurePeople(acts.map((a) => a.character));
    if (acts.length > 0) {
      const counted = await api.tallies(acts.map((a) => a.id));
      for (const [id, t] of Object.entries(counted)) tallies.merge(id, t);
    }
  }, [api, ensurePeople, tallies]);

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

  /* ---------------------------------------------------------------------- reading ---- */
  const sent = useRef(0);
  const seen = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (seen.current > sent.current) {
      sent.current = seen.current;
      void api.markRead(thread, seen.current, hud.current);
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
      const [acts, reading, prefs] = await Promise.all([api.acts(thread, start, end), api.reading([thread]), api.preferences()]);
      await prepare(acts);
      if (!live) return;
      sent.current = Math.max(sent.current, reading[thread] ?? 0);
      setLayout(prefs.postbit);
      dispatch({ type: 'loaded', summary, firstPage: page, lastPage: page, acts, tailLoaded: acts.length < end - start + 1 });
      setStatus('ready');
      const seq = goal.current.seq !== null && goal.current.seq <= summary.lastSeq ? goal.current.seq : null;
      /* The canonical address of where this landed: the page, and the post when one was asked for. */
      const to_ = threadHref(thread, page, seq ?? undefined);
      selfNav.current = to_.slice(to_.indexOf('?'));
      navigate(to_, { replace: true });
      scrollTo.current = { seq: seq ?? start, scroll: true, focus: seq !== null || reloaded.current };
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
      dispatch({ type: 'more', page, acts, tailLoaded: acts.length < end - start + 1 });
      const href = threadHref(thread, page);
      selfNav.current = href.slice(href.indexOf('?'));
      navigate(href, { replace: true });
      /* Focus moves to the first new post and nothing scrolls: it is just below what the reader had. */
      const first = acts[0]?.seq;
      if (first != null) scrollTo.current = { seq: first, scroll: false, focus: true };
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
  const authors = useRef(new Map<Id, Promise<Id | null>>());
  useEffect(() => {
    const announce = (a: Act) => {
      /* New posts only: a card, an unmask or a tally still appears, and is not announced. */
      if (a.kind !== 'post' || announcedIds.current.has(a.id)) return;
      announcedIds.current.add(a.id);
      const name = a.character === null ? 'The System' : people.current.get(a.character)?.character.name ?? 'a character';
      setLines((l) => [...l, { key: ++lineKey.current, text: `New post by ${name}` }].slice(-ANNOUNCED));
    };
    const listener: ThreadListener = {
      onAct(a) {
        const f = feedRef.current;
        if (f.shown.has(a.id) || f.held.has(a.id)) { dispatch({ type: 'live', act: a }); return; }
        if (a.seq === null) return;
        if (f.ready && a.seq <= f.baseEnd) return;
        if (inflight.current.has(a.id)) { inflight.current.set(a.id, a); return; }
        inflight.current.set(a.id, a);
        void ensurePeople([a.character]).then(() => {
          const latest = inflight.current.get(a.id)!;
          inflight.current.delete(a.id);
          dispatch({ type: 'live', act: latest });
          if (feedRef.current.ready) announce(latest);
        });
      },
      onTally(act, t) {
        const grew = tallies.merge(act, t);
        if (!grew) return;
        const f = feedRef.current;
        const here = f.shown.get(act) ?? f.held.get(act);
        const landed = (character: Id | null) => { if (character !== null && own.current.has(character)) reactionLanded.current(); };
        if (here) { landed(here.character); return; }
        /* An Act on another page: who wrote it is read once. */
        let author = authors.current.get(act);
        if (!author) {
          author = api.act(act).then((x) => x?.character ?? null, () => null);
          authors.current.set(act, author);
        }
        void author.then(landed);
      },
    };
    return api.subscribeThread(thread, listener);
  }, [api, thread, ensurePeople, tallies]);

  /* At the bottom of the last page, held Acts come in, sliding. */
  useEffect(() => {
    if (feed.ready && atBottom && feed.tailLoaded && feed.held.size > 0) dispatch({ type: 'release', slide: !motionReduced(), force: false });
  }, [feed, atBottom]);

  /* A gap that does not fill (a broadcast that never came) is read from the server. */
  const gap = useMemo(() => {
    if (!feed.ready || !feed.tailLoaded || feed.held.size === 0) return null;
    const first = ordered(feed.held)[0]!.seq!;
    const end = shownEnd(feed);
    return first > end + 1 ? { start: end + 1, end: feed.knownLast } : null;
  }, [feed]);
  useEffect(() => {
    if (!gap) return;
    const t = setTimeout(() => {
      void api.acts(thread, gap.start, gap.end).then(async (acts) => { await prepare(acts); dispatch({ type: 'fill', acts }); }, () => { /* the next Act asks again */ });
    }, GAP_FILL_MS);
    return () => clearTimeout(t);
  }, [api, thread, gap, prepare]);

  /* ---------------------------------------------------------------- derived things ---- */
  const index = useCallback((id: Id): Located | undefined => {
    const a = feedRef.current.shown.get(id) ?? feedRef.current.held.get(id);
    return a && a.seq !== null ? { thread: a.thread, seq: a.seq } : undefined;
  }, []);
  const context = useMemo<ThreadContext | null>(() => (feed.summary ? { thread, perPage: P, summary: feed.summary, tallies, observer } : null), [thread, P, feed.summary, tallies, observer]);
  const shown = useMemo(() => ordered(feed.shown), [feed.shown]);

  const showHeld = () => {
    const first = ordered(feedRef.current.held)[0]?.seq ?? null;
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
  const heldList = ordered(feed.held);
  const waiting = heldList.length;
  const noun = `${waiting} new ${waiting === 1 ? 'post' : 'posts'}`;
  let bar: { readonly href: string | null; readonly text: string } | null = null;
  if (waiting > 0 && !(atBottom && feed.tailLoaded)) {
    if (feed.tailLoaded) bar = { href: null, text: noun };
    else {
      /* On an earlier page: say which page the new posts are on, and lead there. */
      const firstSeq = heldList[0]!.seq!;
      const lo = pageOf(firstSeq, P);
      const hi = pageOf(heldList.at(-1)!.seq!, P);
      bar = { href: threadHref(thread, lo, firstSeq), text: `${noun} on ${hi === lo ? `page ${lo}` : `pages ${lo} to ${hi}`}` };
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
    <div className="kb-thread" data-kb-thread={thread} aria-busy={busy || undefined}>
      <p className="kb-crumb"><Link to="/">Index</Link> › {summary.title}</p>
      <h1 className="kb-heading kb-thread-title">{summary.title}</h1>
      <p className="kb-thread-info kb-small kb-muted">Started <Ago at={summary.createdAt} /></p>
      {pager('top')}
      <ActIndex.Provider value={index}>
        <ThreadCtx.Provider value={context}>
          <div className="kb-acts">
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
      <div className="kb-visually-hidden" role="status" aria-live="polite" aria-atomic="false">
        {lines.map((l) => <p key={l.key}>{l.text}</p>)}
      </div>
      {bar && (
        <div className="kb-new-bar">
          {bar.href
            ? <Link className="kb-button" data-kb-primary="" to={bar.href}>{bar.text}</Link>
            : <button type="button" className="kb-button" data-kb-primary="" onClick={showHeld}>{bar.text}</button>}
        </div>
      )}
    </div>
  );
}
