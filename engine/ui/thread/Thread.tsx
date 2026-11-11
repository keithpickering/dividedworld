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
import { lowerFirst } from '../copy-words.ts';
import { billPost, drawnOf } from '../cards/billing.ts';
import { CalloutProvider } from '../cards/Callout.tsx';
import { LensProvider } from '../cards/Lens.tsx';
import { createPlays, effectCards, hydrate, readEffects, readSurface } from '../cards/plays.ts';
import { Composer, SystemBoardNote, type ComposerHandle } from '../composer/Composer.tsx';
import { useKayfa } from '../context.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import type { Act, Id, ThreadListener, ThreadPage, ThreadSummary, Visit } from '../data/api.ts';
import { pageList, useIsAdmin } from '../mini.tsx';
import { useBoot } from '../boot.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { motionReduced } from '../appearance.ts';
import { usePlayer } from '../player.tsx';
import { PresenceBox } from '../presence/PresenceBox.tsx';
import type { PostbitLayout, PostbitPerson } from '../postbit/Postbit.tsx';
import { reveals } from '../postbit/reveals.ts';
import { Link, useLocation, useNavigate, useNavigation } from '../router.tsx';
import { returnOf, type ThreadReturn } from '../glass/back.ts';
import { emptyFeed, feedReducer, newer, ordered, shownEnd, waitingPosts, type Feed, type FeedAction } from './feed.ts';
import { ActIndex, actLoader, type Located } from './locate.tsx';
import { pageEndsThread, pageOf, pageRange, seqOfHash, threadHref } from './pages.ts';
import { FollowControl } from './Follow.tsx';
import { ActArticle, ThreadHead } from './Post.tsx';
import { SelectionQuote } from './SelectionQuote.tsx';
import { ThreadCtx, type ThreadContext } from './context.ts';
import { text } from './lines.tsx';
import { createMine } from '../reactions/mine.ts';
import { spunCount, spunLoader, type Spun } from '../spin/spun.ts';
import { createTallies } from './tallies.ts';
import { useShowOpenThread } from './open.tsx';
import './thread.css';

/** How long a reader's position settles before it is sent. */
export const READ_DEBOUNCE_MS = 400;
/** How long a live Act waits for the one before it before the gap is read from the server. */
export const GAP_FILL_MS = 1500;
/** The longest wait between two tries at reading a gap that will not fill. */
export const GAP_RETRY_MAX_MS = 30_000;
/** The announcer keeps the last few lines; a screen reader hears what is added. */
const ANNOUNCED = 4;

/**
 * The thread screen draws its document (the forum-load plan, Task 13): the page the router loaded, whole on the first frame. Signed out, the
 * loader's marker is the front door.
 */
export function ThreadScreen({ thread, doc }: { readonly thread: Id; readonly doc: ScreenDoc<ThreadPage> }) {
  if (isSignedOutDoc(doc)) return <FrontDoor />;
  return <ThreadView key={thread} thread={thread} doc={doc} />;
}

/** The feed's first (or a new) page, from a document: the Acts it holds and whether they reach the thread's last. */
function loadedFrom(page: ThreadPage, perPage: number, back: ThreadReturn | null): FeedAction {
  const { start, end } = pageRange(page.page, perPage);
  const ends = pageEndsThread(page.acts.length, { start, end }, page.thread.lastSeq);
  return { type: 'loaded', summary: page.thread, firstPage: page.page, lastPage: page.page, acts: page.acts, tailLoaded: ends, through: ends ? page.thread.lastSeq : end, back };
}

const keyOf = (l: { query: URLSearchParams; hash: string }) => `${l.query.toString() ? `?${l.query.toString()}` : ''}${l.hash ? `#${l.hash}` : ''}`;

function ThreadView({ thread, doc }: { readonly thread: Id; readonly doc: ThreadPage }) {
  const { api, settings, ui } = useKayfa();
  const P = settings.postsPerPage;
  const player = usePlayer();
  /* Only an admin's Lens offers "End this card": the page asks once, as Updates does. */
  const admin = useIsAdmin(api, player.session.signedIn);
  const navigate = useNavigate();
  const { track } = useNavigation();
  const loc = useLocation();
  const boot = useBoot();

  const feedRef = useRef<Feed>(emptyFeed);
  /* The thread's board, known from the document's summary before the feed holds it: what the page's board card is read on. */
  const boardOf = useRef<Id | null>(doc.thread.board);
  /* The preferences boot brought; a screen with no boot (a story, a sign-in on this page) reads them once, after it has landed. */
  const [layout, setLayout] = useState<PostbitLayout>(boot?.preferences.postbit ?? 'side');
  const [busy, setBusy] = useState(false);
  const [atBottom, setAtBottom] = useState(() => typeof IntersectionObserver === 'undefined');
  const [lines, setLines] = useState<readonly { readonly key: number; readonly text: string }[]>([]);
  const tallies = useMemo(() => createTallies(), []);
  const mine = useMemo(() => createMine(), []);
  /* The card plays on the posts on screen (engine/ui/cards/plays.ts), and which cards the instance draws an effect for: only theirs have a state to read. */
  const plays = useMemo(() => createPlays(), []);
  const effects = useMemo(() => effectCards(ui), [ui]);
  const effectList = useMemo(() => [...effects], [effects]);
  /* Whether this is a thread of The System's board, where replies are spins and there is no reply box. */
  const [systemBoard, setSystemBoard] = useState<boolean | null>(() => (doc.board ? doc.board.isSystem : null));
  /* The boards could not be read, so which kind of board this is is unknown: neither the reply box nor the System's note is shown. */
  const [boardUnread, setBoardUnread] = useState(() => !doc.board);
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

  /* Each post's latest visit as the pages read so far carried it (Visit.tsx); a visit that changed on a page read again redraws the posts. */
  const visitsHeld = useRef(new Map<Id, Visit>());
  const [visitTick, setVisitTick] = useState(0);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  /* A character's name as the thread knows it: read before the posts that name it are drawn. */
  const nameOf = useCallback((id: Id | null) => (id === null ? ui.copy.staffWord : people.current.get(id)?.character.name ?? 'A character'), [ui.copy.staffWord]);
  const faceOf = useCallback((id: Id | null) => (id === null ? null : people.current.get(id)?.character.avatarSquare ?? null), []);
  const pronounsOf = useCallback((id: Id | null) => (id === null ? ENGINE_DEFAULT_PRONOUNS : people.current.get(id)?.character.pronouns ?? ENGINE_DEFAULT_PRONOUNS), []);

  /*
   * The plays above the posts that each page number's latest read held, so a later read of the same page can tell which have left it. Each
   * read takes a ticket when it is asked (the first document's is 0), and only a read asked after the one remembered is compared and
   * remembered: answers arrive in any order, and an older one must not end what a newer one saw.
   */
  const aboveOf = useRef(new Map<number, { readonly ticket: number; readonly ids: ReadonlySet<Id> }>());
  const tickets = useRef(0);
  /*
   * A page document taken into the stores: its authors, the plays on its posts and above them with their saved states, the player's releases
   * and card backs, the tallies, the player's own reactions and the threads spun from them, all ready to show, and each post's plays billed
   * (cards/billing.ts), once for this page: a live count moves no tag. No read: the document holds what a page used to read in a dozen.
   */
  const absorb = useCallback((page: ThreadPage, ticket: number) => {
    const said = reveals(page.people.flatMap((p) => p.reveals), page.people.flatMap((p) => p.turns));
    for (const p of page.people) {
      const statement = said.get(p.character.id);
      const person: PostbitPerson = {
        character: p.character, posts: p.posts, standing: p.standing,
        revealed: statement?.revealed ?? null, turnedAt: statement?.turnedAt ?? null,
      };
      /* A person read again who is as they were stays the same object, so a page read again redraws no post for it. */
      const held = people.current.get(p.character.id);
      if (!held || JSON.stringify(held) !== JSON.stringify(person)) people.current.set(p.character.id, person);
      asked.current.set(p.character.id, Promise.resolve());
    }
    const played = [...page.plays, ...page.above.map((x) => x.act)];
    hydrate(plays, played, page.states, page.releases, page.faces, page.surfaces);
    /* A play leaves a page's `above` when an admin ended it, when its thread moved, or when its time ran out (the server drops a play past its
       end; a reach play past its time is already hidden by the clock, so marking it changes nothing a reader sees), and sends no `card_end`
       with it: a page read again says so by what it no longer holds. Only a read asked after the remembered one says so. */
    const was = aboveOf.current.get(page.page);
    if (!was || ticket > was.ticket) {
      const above = new Set(page.above.map((x) => x.act.id));
      if (was) plays.setEnded([...was.ids].filter((id) => !above.has(id)));
      aboveOf.current.set(page.page, { ticket, ids: above });
    }
    const posts = page.acts.filter((a) => a.kind === 'post').map((a) => a.id);
    const ids = [...new Set([...page.acts.map((a) => a.id), ...played.map((a) => a.id)])];
    for (const [id, t] of Object.entries(page.tallies)) tallies.merge(id, t);
    for (const id of ids) mine.merge(id, page.mine.filter((r) => r.act === id));
    const loader = spunLoader(api);
    const from = new Map<Id, ThreadSummary[]>();
    for (const t of page.spun) if (t.originActId !== null) from.set(t.originActId, [...(from.get(t.originActId) ?? []), t]);
    const spun = new Map<Id, Spun>();
    for (const id of ids) { loader.seed(id, from.get(id) ?? []); spun.set(id, loader.peek(id)!); }
    for (const post of posts) billPost(plays, post, spun, (play) => drawnOf(tallies.get(play), spunCount(spun.get(play)!)));
    let moved = false;
    for (const v of page.visits) {
      const was = visitsHeld.current.get(v.post);
      if (!was || was.id !== v.id || was.end?.act !== v.end?.act) moved = true;
      visitsHeld.current.set(v.post, v);
    }
    if (moved && mounted.current) setVisitTick((n) => n + 1);
  }, [api, tallies, mine, plays]);

  /* The first page: from the document, before the first render, so the first frame is whole. */
  /* What the thread showed and knew of when the reader left for the glass, when Back brought them here; the first page only. */
  const back = useRef(returnOf(loc.state));
  const [feed, dispatch] = useReducer(feedReducer, undefined, () => {
    absorb(doc, 0);
    return feedReducer(emptyFeed, loadedFrom(doc, P, back.current));
  });
  feedRef.current = feed;

  /* A page read from the server (a next page, a gap, a move to a page not shown): one request, on the meter. */
  /* How many times the catch-up has been asked to run by a join (both channels joined), and the way to ask it for one more run. */
  const joins = useRef(0);
  const askCatchUp = useRef<() => void>(() => {});
  /* The ask is made after the render that follows the read, once the caller has put the page in the feed and `feedRef` shows the range as it now stands. */
  const [lateRead, setLateRead] = useState(0);
  const readPage = useCallback(async (at: { readonly page?: number | null; readonly seq?: number | null }): Promise<ThreadPage> => {
    const ticket = ++tickets.current;
    const noted = joins.current;
    const page = await track(api.threadPage(thread, at, P, effectList));
    if (!page) throw new Error('the thread could not be read');
    absorb(page, ticket);
    /* A read the server answered before a join and that landed after it may have run after that join's catch-up finished, so its page was read
       before the channel heard anything and no run reads it again: ask for one more, through the same one-at-a-time path. A read with no join
       between its asking and its answer, or answered before the first join, asks for nothing. */
    if (joins.current !== noted) setLateRead((n) => n + 1);
    return page;
  }, [api, thread, P, effectList, track, absorb]);

  /* ----------------------------------------------------------------- where to scroll ---- */
  const scrollTo = useRef<{ readonly seq: number; readonly scroll: boolean; readonly focus: boolean } | null>(null);
  /* An address this screen wrote itself: the location effect leaves it alone. */
  const selfNav = useRef<string | null>(null);
  const goal = useRef<{ page: number | null; seq: number | null }>({
    page: Number.parseInt(loc.query.get('page') ?? '', 10) || null,
    seq: seqOfHash(loc.hash),
  });
  const [loadKey, setLoadKey] = useState(0);
  /* The card kinds this account has met (the first-time callout, cards/Callout.tsx), as boot brought them. */
  const [cardsMet, setCardsMet] = useState<readonly string[] | null>(() => boot?.preferences.cardsMet ?? null);

  /* ---------------------------------------------------------------------- reading ---- */
  /* How far the reader has read, as the document says; never lower than what was sent. */
  const sent = useRef(doc.reading[thread] ?? 0);
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
  /*
   * Where a page landed: its canonical address (the page, and the post when one was asked for) and where to scroll. The first page is
   * the document's, drawn already; a later one is the reader's own move, and lands at it.
   */
  const settle = useCallback((page: ThreadPage, first: boolean) => {
    const seq = goal.current.seq !== null && goal.current.seq <= page.thread.lastSeq ? goal.current.seq : null;
    const to_ = threadHref(thread, page.page, seq ?? undefined);
    selfNav.current = to_.slice(to_.indexOf('?'));
    navigate(to_, { replace: true });
    /* A page opened with no post asked stays at its top, where its title and pages are. */
    scrollTo.current = { seq: seq ?? pageRange(page.page, P).start, scroll: seq !== null || !first, focus: seq !== null || !first };
  }, [thread, P, navigate]);

  /* The document has landed: its address, made canonical, and its place. Nothing is read. */
  useEffect(() => {
    settle(doc, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the document the screen was given
  }, []);

  /* A screen with no boot reads the preferences it draws by, once, after it has landed. */
  useEffect(() => {
    if (boot) return undefined;
    let live = true;
    void api.preferences().then((prefs) => { if (live) { setLayout(prefs.postbit); setCardsMet(prefs.cardsMet); } }, () => { /* the defaults stand */ });
    return () => { live = false; };
  }, [api, boot]);

  /* A move to a page that is not on screen (an address the reader chose): one read, replacing the pages shown. */
  useEffect(() => {
    if (loadKey === 0) return undefined;
    let live = true;
    setBusy(true);
    void (async () => {
      const page = await readPage({ page: goal.current.page, seq: goal.current.seq });
      if (!live) return;
      boardOf.current = page.thread.board;
      sent.current = Math.max(sent.current, page.reading[thread] ?? 0);
      /* Known before the first post is drawn, so the reply box and the posts' Quote links do not change the page after it. */
      setSystemBoard(page.board ? page.board.isSystem : null);
      setBoardUnread(!page.board);
      dispatch(loadedFrom(page, P, null));
      settle(page, false);
    })().catch(() => { /* the address stays as it is; the reader can try again */ }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new read is asked for by loadKey
  }, [loadKey]);

  /* The address changed by the reader (a link, back, a pager): show it, reading more only when it is not on screen. */
  const handled = useRef(loc);
  useEffect(() => {
    /* The address the screen opened at is the document's: nothing to do for it. */
    if (handled.current === loc) return;
    handled.current = loc;
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
      const read = await readPage({ page });
      const acts = read.acts;
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
  }, [thread, P, readPage, navigate]);

  /*
   * The window between the server reading the document and this screen's channels being joined: whatever lands in it is neither in the
   * document nor heard, and so is whatever lands while a dropped channel is rejoining. Not only posts: a card played, set face down or
   * sprung, an admin's end of a play, an edit, a reaction, a saved effect state and a play beyond a post take no place in the thread, and
   * nothing a summary says moves for them. So once both channels have said they are joined (and again each time either rejoins) the
   * pages the screen draws are read again, as the router read them: a page is everything it draws, so each kind it draws is caught up, and
   * a kind it comes to draw is caught up with no change here. Every store takes a page in idempotently; an Act already shown or held is
   * given to the feed as it is now (an edit is the newer version), and a post it has not met is held behind the bar, as a live one is. A
   * play above the posts that a page no longer holds is marked ended (`absorb`). The drawn pages are read quietly, one after another,
   * since the reader asked for nothing; pages beyond the drawn tail, for posts that landed in the window, are read on the meter as a gap
   * is. Nothing moves under the reader: no scroll, no focus, and a post already announced is not announced again. One catch-up runs at a
   * time, and joins that arrive during one make exactly one more. A read that fails is asked again twice, at the gap's pace, and then the
   * run is left: a reload, or the next join, reads it.
   */
  const joined = useRef({ thread: false, reach: false });
  const running = useRef({ going: false, again: false });
  const sleeping = useRef(new Set<() => void>());
  const catchUpWith = useRef<() => Promise<void>>(async () => {});
  catchUpWith.current = async () => {
    const tried = async <T,>(read: () => Promise<T | null>): Promise<T | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!mounted.current) return null;
        try {
          const got = await read();
          if (got) return got;
        } catch { /* asked again below */ }
        if (attempt < 2) await new Promise<void>((resolve) => {
          const wake = () => { clearTimeout(timer); sleeping.current.delete(wake); resolve(); };
          const timer = setTimeout(wake, Math.min(GAP_FILL_MS * 2 ** attempt, GAP_RETRY_MAX_MS));
          sleeping.current.add(wake);
        });
      }
      return null;
    };
    const start = feedRef.current;
    if (!start.ready) return;
    /* The pages this run reads are the ones drawn when it began. A read that was asked before the join and lands during the run (a next page, a jump) moves them,
       and its window is not caught up by this run: it stops and asks for one more, which reads the range as it now stands. The run's own `fill` moves neither end. */
    const moved = () => {
      if (feedRef.current.firstPage === start.firstPage && feedRef.current.lastPage === start.lastPage) return false;
      running.current.again = true;
      return true;
    };
    let lastSeq = start.serverLast;
    for (let page = start.firstPage; page <= start.lastPage; page++) {
      let ticket = 0;
      const read = await tried(() => { ticket = ++tickets.current; return api.threadPage(thread, { page }, P, effectList); });
      if (!read || !mounted.current) return;
      absorb(read, ticket);
      if (moved()) return;
      lastSeq = Math.max(lastSeq, read.thread.lastSeq);
      const fresh: Act[] = [];
      for (const a of read.acts) {
        const f = feedRef.current;
        const was = f.shown.get(a.id) ?? f.held.get(a.id);
        if (!was) fresh.push(a);
        else if (JSON.stringify(was) !== JSON.stringify(a)) dispatch({ type: 'live', act: a });
      }
      if (fresh.length > 0 && feedRef.current.tailLoaded) dispatch({ type: 'fill', acts: fresh });
    }
    /* Posts on pages beyond the drawn tail: read as a gap is, on the meter. */
    for (let from = pageRange(feedRef.current.lastPage, P).end + 1; feedRef.current.tailLoaded && from <= lastSeq; ) {
      const at = from;
      const read = await tried(async () => { try { return await readPage({ seq: at }); } catch { return null; } });
      if (!read || !mounted.current) return;
      if (moved()) return;
      lastSeq = Math.max(lastSeq, read.thread.lastSeq);
      if (feedRef.current.tailLoaded) dispatch({ type: 'fill', acts: read.acts.filter((a) => a.seq !== null && a.seq >= at) });
      const next = pageRange(read.page, P).end + 1;
      if (next <= from) break;
      from = next;
    }
  };
  const joinedAt = useCallback((which: 'thread' | 'reach') => {
    joined.current[which] = true;
    if (!joined.current.thread || !joined.current.reach || !mounted.current) return;
    joins.current++;
    askCatchUp.current();
  }, []);
  askCatchUp.current = () => {
    if (!mounted.current) return;
    const run = running.current;
    if (run.going) { run.again = true; return; }
    run.going = true;
    void (async () => {
      try {
        do {
          run.again = false;
          await catchUpWith.current().catch(() => { /* left for the next join */ });
        } while (run.again && mounted.current);
      } finally { run.going = false; }
    })();
  };
  useEffect(() => { if (lateRead > 0) askCatchUp.current(); }, [lateRead]);
  useEffect(() => () => { for (const wake of [...sleeping.current]) wake(); }, []);

  /* ----------------------------------------------------------------------- live ---- */
  /* A live Act's follow-up read that goes wrong is dropped: the next read of the page shows what it would have, and nothing is thrown at the page. */
  const quietly = () => {};
  const announcedIds = useRef(new Set<Id>());
  /* Acts whose characters are being read, with the latest version of each that has arrived since. */
  const inflight = useRef(new Map<Id, Act>());
  const lineKey = useRef(0);
  useEffect(() => {
    const announce = (a: Act) => {
      /* New posts only: an unmask or a tally still appears, and is not announced. */
      if (a.kind !== 'post' || announcedIds.current.has(a.id)) return;
      announcedIds.current.add(a.id);
      const name = a.character === null ? lowerFirst(ui.copy.staffWord) : people.current.get(a.character)?.character.name ?? 'a character';
      setLines((l) => [...l, { key: ++lineKey.current, text: `New post by ${name}` }].slice(-ANNOUNCED));
    };
    const listener: ThreadListener = {
      onAct(a) {
        /* A draw or a wash is no post and no line of the thread: the surface it is on is told on its own event (`onSurface`). */
        if (a.kind === 'draw' || a.kind === 'wash') return;
        /* A card play is a tag on its post, never a place in the thread: it is added to the post it names, wherever that post is, once its caster is known. */
        if (a.kind === 'card') {
          void ensurePeople([a.character]).then(() => { plays.add([a]); return readEffects(api, plays, [a], effects); }).catch(quietly);
          return;
        }
        /* An admin's end of a play is no tag: it marks its play reversed in the store, wherever the play is (or waits for it). */
        if (a.kind === 'card_end') { plays.add([a]); return; }
        /* A card set face down is a back on its post; a spring reveals the back in its place, moving no mark (the card mechanic's design). */
        if (a.kind === 'set' || a.kind === 'spring') {
          void ensurePeople([a.character]).then(() => {
            plays.add([a]);
            if (a.kind === 'set') return api.myFaceDown([a.id]).then((faces) => { plays.setFaces(faces); }, () => {});
            return undefined;
          }).catch(quietly);
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
        }).catch(() => { inflight.current.delete(a.id); });
      },
      onEffect(play) {
        /* A saved state is read where it is kept, by the play it names: the post author's newest version is what every reader loads. */
        void api.effectStates([play]).then((saved) => plays.setStates(saved), () => { /* the next save is heard again */ });
      },
      onSurface(play, covered) {
        /* A draw or a wash landed: the cells it covers now, for every wall of the page; the live Acts of the play alone, and only if they are drawn (a wall that was near). */
        plays.setSurfaces({ [play]: { covered } });
        if (plays.wantsSurface(play)) void readSurface(api, plays, play);
      },
      onJoined() { joinedAt('thread'); },
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
    const off = api.subscribeThread(thread, listener);
    return () => { off(); joined.current.thread = false; };
  }, [api, thread, ensurePeople, tallies, plays, effects, ui.copy.staffWord, joinedAt]);

  /* A play beyond a post is announced on `reach`, which every signed-in page hears, since it is played from a post in some other thread
     as often as this one (a character's) and on The System's announcements thread (a board's). This page keeps the plays whose target it
     shows: this thread, this thread's board, or a character with a post in view; the rest are dropped, so its memory is its screen's.
     It then reads the play as it reads one on its own thread (the caster's name first), so the mark is drawn the same. */
  useEffect(() => {
    const off = api.subscribeReach({
    onJoined() { joinedAt('reach'); },
    onPlay(a) {
      /* The end of a play beyond a post names only its play: the store marks it if the play is one this page keeps, and holds it otherwise. */
      if (a.kind === 'card_end') { plays.add([a]); return; }
      if (a.kind !== 'card') return;
      const reach = a.payload.reach;
      const shown = reach === 'thread' ? a.payload.thread === thread
        : reach === 'board' ? boardOf.current !== null && a.payload.board === boardOf.current
        : reach === 'character' ? typeof a.payload.character === 'string' && people.current.has(a.payload.character) : false;
      if (!shown) return;
      void ensurePeople([a.character]).then(() => { plays.add([a]); return readEffects(api, plays, [a], effects); }).catch(quietly);
    },
    });
    return () => { off(); joined.current.reach = false; };
  }, [api, thread, ensurePeople, plays, effects, joinedAt]);

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
    /* The gap is read from the page that holds its start; a gap longer than a page takes a read for each page it spans. */
    const acts: Act[] = [];
    for (let from = start; from <= feedRef.current.knownLast; ) {
      const read = await readPage({ seq: from });
      acts.push(...read.acts.filter((a) => a.seq !== null && a.seq >= from && a.seq <= feedRef.current.knownLast));
      const next = pageRange(read.page, P).end + 1;
      if (next <= from) break;
      from = next;
    }
    dispatch({ type: 'fill', acts });
  }, [P, readPage]);
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
  /* Highlight-to-quote: a selection's words go in as typed, and the post is found by the number its article carries. */
  const quoteSelected = useCallback((a: Act, words: string) => composer.current?.quote(a.id, words, true), []);
  const changed = useCallback((a: Act) => dispatch({ type: 'live', act: a }), []);
  const canReply = systemBoard === false;
  /* The HUD's Reveal starts on this thread, except on The System's board (and until the board is known), where a meta act is not made. It is cleared when the screen goes. */
  useShowOpenThread(systemBoard === false && feed.summary ? { id: thread, title: feed.summary.title, board: feed.summary.board } : null);
  const visits = useMemo<ReadonlyMap<Id, Visit>>(() => new Map(visitsHeld.current), [visitTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const context = useMemo<ThreadContext | null>(
    () => (feed.summary ? { thread, perPage: P, summary: feed.summary, tallies, mine, plays, visits, nameOf, faceOf, pronounsOf, know: ensurePeople, observer, quote: canReply ? quote : null, changed } : null),
    [thread, P, feed.summary, tallies, mine, plays, visits, nameOf, faceOf, pronounsOf, ensurePeople, observer, canReply, quote, changed],
  );
  const shown = useMemo(() => ordered(feed.shown), [feed.shown]);
  const quotableAt = useCallback((seq: number) => {
    const a = shown.find((x) => x.seq === seq);
    return a && (a.kind === 'post' || a.kind === 'spin') ? a : undefined;
  }, [shown]);

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
  if (!context || !feed.summary) return <div className="kb-thread" aria-busy="true" />;

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

  /* The board's name for the crumb: the page's own board, or the frame's list of boards (boot's) by the thread's board. Neither known, the crumb leaves it out. */
  const crumbBoard = doc.board ?? boot?.boards.find((b) => b.id === summary.board) ?? null;

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
      <p className="kb-crumb"><Link to="/">Index</Link> › {crumbBoard && <><Link to={`/b/${crumbBoard.slug}`}>{crumbBoard.name}</Link> › </>}{summary.title}</p>
      <ActIndex.Provider value={index}>
        <ThreadCtx.Provider value={context}>
          <CalloutProvider met={player.session.signedIn ? cardsMet : null}>
          <LensProvider admin={admin}>
            <ThreadHead pager={pager('top')} />
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
          </LensProvider>
          </CalloutProvider>
        </ThreadCtx.Provider>
      </ActIndex.Provider>
      {canReply && <SelectionQuote actOf={quotableAt} quote={quoteSelected} />}
      <div ref={endRef} className="kb-thread-end" data-kb-end="" aria-hidden="true" />
      {!feed.tailLoaded && (
        <p className="kb-thread-continue">
          <Link
            to={threadHref(thread, feed.lastPage + 1)}
            onClick={(e) => { e.preventDefault(); void continueTo(); }}
          >Continue to page {feed.lastPage + 1}</Link>
        </p>
      )}
      {/* Follow sits after the last post, where a reader decides whether to keep up (the board draws no control above the thread), in the bottom pager's row, at its right. */}
      <div className="kb-thread-below">
        {pager('bottom')}
        {player.session.signedIn && <FollowControl thread={thread} following={doc.following} />}
      </div>
      {systemBoard !== null && (
        <ActIndex.Provider value={index}>
          <ThreadCtx.Provider value={context}>
            {systemBoard ? <SystemBoardNote /> : <Composer ref={composer} thread={thread} board={summary.board} latest={latest} since={() => feedRef.current.knownLast} onPosted={(a) => void posted(a)} />}
          </ThreadCtx.Provider>
        </ActIndex.Provider>
      )}
      {systemBoard === null && boardUnread && (
        <p className="kb-composer-note kb-notice" data-kb-tone="refusal">
          The board this thread is on could not be read, so the reply box is left out. <button type="button" className="kb-link-button" onClick={() => void readBoard()}>Try again</button>
        </p>
      )}
      <PresenceBox place={{ kind: 'thread', thread }} heading="Users browsing this thread" snapshot={doc.presence} />
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
