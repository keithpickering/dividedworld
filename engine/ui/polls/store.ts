/**
 * The polls on the posts a thread screen shows, kept apart from the page like the tallies are (thread/tallies.ts): a ballot or a close heard live changes
 * the one poll it names and wakes only the post it is on. A post reads its own through `usePoll`.
 *
 * What it holds for each post is the post's current poll (`Poll`: counts, voters, end, close), a public poll's counted voters (newest first, and whether more
 * are unread: `more`), and the caller's own counted ballots on it (`mine`, a secret poll's and a withdrawal's too). Everything it takes is ordered so a late
 * or doubled event changes nothing: counts by `pollHeard` (a closed poll's are final), a poll Act, a ballot and a close by their own (time, id).
 * The names of the voters listed are kept here too, since a voter is read for the poll alone and never joins the thread's own people.
 */
import { useSyncExternalStore } from 'react';
import { pollHeard, type Act, type Ballot, type Character, type Id, type Poll, type PollBallot, type PollEvent, type PollParts, type PollVoter, type PollWritten } from '../data/api.ts';

export interface PollView {
  readonly poll: Poll;
  /** A public poll's counted ballots with picks, newest first; none for a secret poll. */
  readonly voters: readonly PollVoter[];
  /** Whether counted voters exist that `voters` does not hold: the rest are read with `pollBallots`. */
  readonly more: boolean;
  /** The caller's own counted ballots on this poll, one for each of their characters, a withdrawal's included. */
  readonly mine: readonly Ballot[];
}

export interface Polls {
  get(post: Id): PollView | undefined;
  subscribe(post: Id, listener: () => void): () => void;
  /** The post a poll held here is on, or undefined where the store holds no such poll. */
  postOf(poll: Id): Id | undefined;
  /** A voter's name as the poll knows it, or undefined where it was never read. */
  name(character: Id): string | undefined;
  /**
   * What a page read says of the polls on `posts` (`ThreadPage`): the poll of each, its voters, and the caller's ballots. `ticket` is the clock value when the read was asked: a poll
   * changed by anything heard (or cast) since is newer than the read and keeps what it holds, as a tally keeps its largest. A post in `posts` the page holds no poll for has none now.
   */
  take(page: PollParts & { readonly voterCast: readonly Character[] }, ticket: number, posts: readonly Id[]): void;
  /** A `poll` event: the counts, in order. */
  counts(event: PollEvent): void;
  /** A poll Act heard live: the post's poll replaced (an edit's), or taken away. */
  pollAct(act: Act): void;
  /** A close heard live. */
  closeAct(act: Act): void;
  /** A ballot heard live. Returns a voter listed whose name is not known, for the caller to read once. */
  ballotAct(act: Act, own: ReadonlySet<Id>): Id | null;
  /** What `castBallot` answered, for the caller's own ballot: the ballot is theirs (`mine`) and a public poll lists it. */
  cast(poll: Id, character: Id, picks: readonly number[], written: PollWritten): void;
  /** What a close answered. */
  closed(written: PollWritten): void;
  /** Voters the ballots' history named (`pollBallots`), the counted ones; `done` says the history is read to its end. */
  fill(poll: Id, ballots: readonly PollBallot[], done: boolean): void;
  named(characters: readonly Character[]): void;
}

const time = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? 0 : t; };
/** Whether (at, id) is after (than, thanId): by time, then id. */
const after = (at: string, id: Id, than: string, thanId: Id) => time(at) > time(than) || (time(at) === time(than) && id > thanId);
const picksOf = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : []);

/** `clock` gives each live change its place in the order the thread's reads are asked in (its tickets), so a late read can be told from a newer event. */
export function createPolls(clock: () => number = () => 0): Polls {
  const views = new Map<Id, PollView>();
  /* A poll's id to its post, so a ballot or a close finds where it goes. */
  const postOf = new Map<Id, Id>();
  /* A post whose poll was taken away: an older poll Act heard late must not bring it back. */
  const removed = new Map<Id, { at: string; id: Id }>();
  /* When each poll and each post was last changed by something heard or cast, on `clock`. */
  const touched = new Map<Id, number>();
  const touch = (...keys: Id[]) => { const at = clock(); for (const k of keys) touched.set(k, at); };
  const names = new Map<Id, string>();
  /* The voters a read was asked for: each is read once, for its name. */
  const asked = new Set<Id>();
  const listeners = new Map<Id, Set<() => void>>();

  const wake = (post: Id) => { for (const l of [...(listeners.get(post) ?? [])]) l(); };
  const set = (post: Id, view: PollView | undefined) => {
    const was = views.get(post);
    if (was !== undefined && was.poll.act.id !== view?.poll.act.id) postOf.delete(was.poll.act.id);
    if (view === undefined) views.delete(post); else { views.set(post, view); postOf.set(view.poll.act.id, post); }
    wake(post);
  };
  const viewOf = (poll: Id): { post: Id; view: PollView } | undefined => {
    const post = postOf.get(poll);
    const view = post === undefined ? undefined : views.get(post);
    return post === undefined || view === undefined ? undefined : { post, view };
  };
  const secret = (poll: Poll) => poll.act.payload.secret === true;
  /* A name that arrives redraws every poll listed: a voter is named wherever it is shown. */
  /* Cost: a new name redraws every post that lists polls on the page (one copy of its view each), once per name that arrives; a page holds at most a page of posts, so that is a page's worth of cheap redraws, and a voter's name arrives once. */
  const note = (characters: readonly Character[]) => {
    let fresh = false;
    for (const c of characters) { if (names.get(c.id) !== c.name) fresh = true; names.set(c.id, c.name); }
    if (!fresh) return;
    for (const [post, view] of [...views]) { views.set(post, { ...view }); wake(post); }
  };

  /** A voter's ballot into a list newest first: replaced where the character has one older, left where it has one newer, dropped when it picks nothing. */
  const withVoter = (voters: readonly PollVoter[], v: PollVoter): readonly PollVoter[] => {
    const had = voters.find((x) => x.character === v.character);
    if (had !== undefined && !after(v.at, v.act, had.at, had.act)) return voters;
    const rest = voters.filter((x) => x.character !== v.character);
    if (v.picks.length === 0) return rest;
    return [...rest, v].sort((a, b) => (after(a.at, a.act, b.at, b.act) ? -1 : 1));
  };
  const withMine = (mine: readonly Ballot[], b: Ballot): readonly Ballot[] => {
    const had = mine.find((x) => x.character === b.character);
    if (had !== undefined && !after(b.at, b.act, had.at, had.act)) return mine;
    return [...mine.filter((x) => x.character !== b.character), b];
  };

  /** One counted ballot taken in, for a poll the store holds: only one before the poll's end counts. */
  function ballot(poll: Id, character: Id, picks: readonly number[], act: Id, at: string, own: boolean): void {
    const here = viewOf(poll);
    if (here === undefined || !(time(at) < time(here.view.poll.endsAt))) return;
    const voters = secret(here.view.poll) ? here.view.voters : withVoter(here.view.voters, { poll, act, character, picks, at });
    const mine = own ? withMine(here.view.mine, { act, poll, character, picks, at }) : here.view.mine;
    if (voters === here.view.voters && mine === here.view.mine) return;
    touch(poll, here.post);
    set(here.post, { ...here.view, voters, mine });
  }

  function closeAct(act: Act): void {
    const here = act.targetActId === null ? undefined : viewOf(act.targetActId);
    if (here === undefined || here.view.poll.close !== null) return;
    touch(act.targetActId!, here.post);
    set(here.post, { ...here.view, poll: { ...here.view.poll, close: act } });
  }

  const heard = pollHeard((e) => {
    const here = viewOf(e.poll);
    if (here === undefined || here.view.poll.closed) return;
    const { poll } = here.view;
    touch(e.poll, here.post);
    set(here.post, { ...here.view, poll: { ...poll, counts: e.counts, voters: e.voters, endsAt: e.endsAt, closed: e.closed } });
  });

  return {
    get: (post) => views.get(post),
    postOf: (poll) => postOf.get(poll),
    subscribe(post, listener) {
      const l = listeners.get(post) ?? new Set();
      listeners.set(post, l.add(listener));
      return () => { l.delete(listener); if (l.size === 0 && listeners.get(post) === l) listeners.delete(post); };
    },
    name: (id) => names.get(id),
    named: note,
    take(page, ticket, posts) {
      note(page.voterCast);
      const more = new Set(page.votersMore);
      const newer = (...keys: Id[]) => keys.some((k) => (touched.get(k) ?? -1) > ticket);
      for (const poll of page.polls) {
        const held = views.get(poll.post);
        /* Something heard or cast after this read was asked is newer than the read: the poll keeps what it holds. */
        if (newer(poll.act.id, poll.post)) continue;
        /* A read that is older than a close or a replacement already heard never undoes it: a poll that is closed keeps its closed counts. */
        if (held !== undefined && held.poll.act.id === poll.act.id && held.poll.closed && !poll.closed) continue;
        if (held !== undefined && held.poll.act.id !== poll.act.id && after(held.poll.act.createdAt, held.poll.act.id, poll.act.createdAt, poll.act.id)) continue;
        const id = poll.act.id;
        /* A secret poll lists no voter, whatever a read carries. */
        const voters = secret(poll) ? [] : page.voters.filter((v) => v.poll === id);
        set(poll.post, { poll, voters, more: !secret(poll) && more.has(id), mine: page.myBallots.filter((b) => b.poll === id) });
      }
      /* A post the page was read for that holds no poll now (an edit took it away) has none here. */
      const held = new Set(page.polls.map((p) => p.post));
      for (const post of posts) {
        const view = views.get(post);
        if (view !== undefined && !held.has(post) && !newer(post, view.poll.act.id)) set(post, undefined);
      }
    },
    counts: heard,
    pollAct(act) {
      const post = act.targetActId;
      if (act.kind !== 'poll' || post === null) return;
      const held = views.get(post)?.poll.act;
      const gone = removed.get(post);
      if (held !== undefined && !after(act.createdAt, act.id, held.createdAt, held.id)) return;
      if (gone !== undefined && !after(act.createdAt, act.id, gone.at, gone.id)) return;
      touch(post, act.id);
      if (act.payload.removed === true) {
        removed.set(post, { at: act.createdAt, id: act.id });
        if (held !== undefined) set(post, undefined);
        return;
      }
      removed.delete(post);
      const options = Array.isArray(act.payload.options) ? act.payload.options : [];
      set(post, {
        poll: { post, act, counts: options.map(() => 0), voters: 0, endsAt: String(act.payload.closes_at), closed: false, close: null },
        voters: [], more: false, mine: [],
      });
    },
    closeAct,
    ballotAct(act, own) {
      const poll = act.targetActId;
      if (act.kind !== 'ballot' || poll === null || act.character === null) return null;
      const here = viewOf(poll);
      if (here === undefined || secret(here.view.poll)) return null;
      const picks = picksOf(act.payload.picks);
      ballot(poll, act.character, picks, act.id, act.createdAt, own.has(act.character));
      if (picks.length === 0 || names.has(act.character) || asked.has(act.character)) return null;
      asked.add(act.character);
      return act.character;
    },
    cast(poll, character, picks, written) {
      ballot(poll, character, picks, written.act.id, written.act.createdAt, true);
      heard({ ...written.counts, at: written.act.createdAt });
    },
    closed(written) {
      closeAct(written.act);
      heard({ ...written.counts, at: written.act.createdAt });
    },
    fill(poll, ballots, done) {
      const here = viewOf(poll);
      if (here === undefined) return;
      note(ballots.map((b) => b.character));
      /* Newest first, so the first ballot of a character before the end is its counted one; a withdrawal is its latest and stops it. */
      const seen = new Set<Id>();
      let voters = here.view.voters;
      for (const b of ballots) {
        if (seen.has(b.character.id) || !(time(b.at) < time(here.view.poll.endsAt))) continue;
        seen.add(b.character.id);
        if (b.picks.length > 0 && !voters.some((v) => v.character === b.character.id)) voters = withVoter(voters, { poll, act: b.act, character: b.character.id, picks: b.picks, at: b.at });
      }
      set(here.post, { ...here.view, voters, more: done ? false : here.view.more });
    },
  };
}

/** One post's poll, redrawn only when this post's poll changes. */
export function usePoll(polls: Polls | undefined, post: Id): PollView | undefined {
  return useSyncExternalStore(
    (l) => (polls === undefined ? () => {} : polls.subscribe(post, l)),
    () => polls?.get(post),
  );
}
