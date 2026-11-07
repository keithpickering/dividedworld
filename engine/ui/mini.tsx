/**
 * The small things the index and the thread list share: a square avatar beside a name, a time as
 * "2 min ago" with its exact time on hover, and the "sign in" prompt a signed-out visitor sees
 * instead of boards (the API needs a session for reads).
 */
import { useEffect, useState } from 'react';
import type { Character, KayfaApi } from './data/api.ts';
import { Link } from './router.tsx';
import { usePlayer } from './player.tsx';
import { useBoot } from './boot.tsx';
import './mini.css';

/** A character's square avatar, or its initial where it has none. Decoration: the name beside it says who. */
export function Mini({ character, name }: { readonly character: Character | undefined; readonly name: string }) {
  return (
    <span className="kb-mini" aria-hidden="true">
      {character?.avatarSquare ? <img src={character.avatarSquare} alt="" loading="lazy" /> : <span className="kb-mini-none">{name.slice(0, 1)}</span>}
    </span>
  );
}

/**
 * The head of a post-like row, a media object: the avatar and the name. `id` is the character's id, which is
 * given apart from `character` because the character may not be loaded yet while its id is known; it is required,
 * and null is The System. `link` draws the name as the profile link, false as plain text in the same place.
 * `name` is what to call the character before it loads. `avatar` false leaves The System's "S" avatar out (the
 * index draws its name alone); a character always has its avatar.
 */
export function Byline({ character, name, link, id, avatar = true }: { readonly character: Character | undefined; readonly name?: string | undefined; readonly link: boolean; readonly id: string | null; readonly avatar?: boolean }) {
  if (id === null) {
    return <>{avatar && <Mini character={undefined} name="S" />}<span className="kb-system-name">The System</span></>;
  }
  const shown = name ?? character?.name ?? 'A character';
  return (
    <>
      <Mini character={character} name={name ?? character?.name ?? 'A'} />
      {link ? <Link to={`/c/${encodeURIComponent(id)}`}>{shown}</Link> : <span className="kb-byline-name">{shown}</span>}
    </>
  );
}

/** "just now", "2 min ago", "3 hr ago", "yesterday", "5 days ago", then a date. */
export function ago(iso: string, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const minute = 60_000;
  if (diff < minute) return 'just now';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} min ago`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} hr ago`;
  const days = Math.floor(diff / (24 * 60 * minute));
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function Ago({ at, now }: { readonly at: string; readonly now?: number }) {
  return <time dateTime={at} title={new Date(at).toLocaleString('en-US')}>{ago(at, now)}</time>;
}

/**
 * Whether the reader is signed in, as the PlayerProvider already knows it: null until it does.
 * It asks the server nothing of its own (the provider has read the session), so a screen's first
 * read never waits a round trip on it. `api` is unused, kept so the screens' call sites stand.
 */
export function useSignedIn(_api: KayfaApi): boolean | null {
  const { session, sessionKnown } = usePlayer();
  return sessionKnown ? session.signedIn : null;
}

/**
 * Whether the signed-in reader is an admin: boot's answer when the first load read it (a screen then reads nothing of its own), else
 * `api.isAdmin`. False until known, and for a read that fails, so an admin's control is never offered on a guess.
 */
export function useIsAdmin(api: KayfaApi, signedIn: boolean | null): boolean {
  const booted = useBoot();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (booted !== null) return undefined;
    if (!signedIn) { setAdmin(false); return undefined; }
    let live = true;
    void api.isAdmin().then((a) => { if (live) setAdmin(a); }, () => { if (live) setAdmin(false); });
    return () => { live = false; };
  }, [api, signedIn, booted]);
  return booted !== null ? signedIn === true && booted.admin : admin;
}

export function SignInPrompt() {
  return (
    <p className="kb-sign-in-prompt">
      The board is for players. <Link to="/sign-in">Sign in</Link> to read it.
    </p>
  );
}

/** The pages to show for a list of `total` pages from page `current`: the first, the last and two either side, with gaps as null. */
export function pageList(current: number, total: number): readonly (number | null)[] {
  const keep = new Set<number>([1, total]);
  for (let p = current - 2; p <= current + 2; p++) if (p >= 1 && p <= total) keep.add(p);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/** The pager of a list that is paged by a link: "Page 2 of 7", Previous, the page numbers, Next; past the end it offers the first page. */
export function PageLinks({ label, page, pages, href }: { readonly label: string; readonly page: number; readonly pages: number; readonly href: (page: number) => string }) {
  return (
    <nav className="kb-pager kb-small" aria-label={label}>
      <span className="kb-pager-where">Page {page} of {pages}</span>
      {page > 1 && page <= pages && <Link to={href(page - 1)}>Previous page</Link>}
      {page > pages && <Link to={href(1)}>First page</Link>}
      {pageList(Math.min(page, pages), pages).map((p, i) => (p === null
        ? <span key={`gap${i}`} aria-hidden="true">…</span>
        : p === page ? <span key={p} className="kb-pager-here" aria-current="page">{p}</span>
          : <Link key={p} to={href(p)} aria-label={`Page ${p}`}>{p}</Link>))}
      {page < pages && <Link to={href(page + 1)}>Next page</Link>}
    </nav>
  );
}
