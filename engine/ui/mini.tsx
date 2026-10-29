/**
 * The small things the index and the thread list share: a square avatar beside a name, a time as
 * "2 min ago" with its exact time on hover, and the "sign in" prompt a signed-out visitor sees
 * instead of boards (the API needs a session for reads).
 */
import { useEffect, useState } from 'react';
import type { Character, KayfaApi } from './data/api.ts';
import { Link } from './router.tsx';
import './mini.css';

/** A character's square avatar, or its initial where it has none. Decoration: the name beside it says who. */
export function Mini({ character, name }: { readonly character: Character | undefined; readonly name: string }) {
  return (
    <span className="kb-mini" aria-hidden="true">
      {character?.avatarSquare ? <img src={character.avatarSquare} alt="" loading="lazy" /> : <span className="kb-mini-none">{name.slice(0, 1)}</span>}
    </span>
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

export function Ago({ at }: { readonly at: string }) {
  return <time dateTime={at} title={new Date(at).toLocaleString('en-US')}>{ago(at)}</time>;
}

/** Whether the visitor is signed in: null until the session is known. */
export function useSignedIn(api: KayfaApi): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void api.session().then((s) => { if (live) setSignedIn(s.signedIn); }, () => { if (live) setSignedIn(false); });
    const off = api.onSession((s) => setSignedIn(s.signedIn));
    return () => { live = false; off(); };
  }, [api]);
  return signedIn;
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
