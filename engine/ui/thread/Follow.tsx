/**
 * The thread page's Follow / Unfollow control, in the glass: a strip of its own above the thread, outside every post and outside the
 * board's table (the alerts design, sections 4 and 12). A thread one's characters started is followed by default; this follows or
 * unfollows any thread, and it is the way out of a thread followed ("No player is ever stuck"; the Alerts row offers the same).
 *
 * Its state is the server's answer to "does the caller follow this thread" (`api.following`), read once on opening, never a guess
 * from the thread's posts: the default depends on who started the thread, which is no one else's business and in no public read.
 * A click asks the server and shows the state it answers; a refusal leaves the button as it was and says why, in plain words.
 * Where the state cannot be read there is no button, since either label could be wrong. Plain words: the glass never bluffs.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';

export function FollowControl({ thread }: { readonly thread: Id }) {
  const { api } = useKayfa();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [unread, setUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFollowing(null);
    setRefused(null);
    setUnread(false);
    void Promise.resolve().then(() => api.following(thread)).then((f) => { if (live) setFollowing(f); }, () => { if (live) setUnread(true); });
    return () => { live = false; };
  }, [api, thread]);

  /* Unread: no control, since either label could be wrong. While it loads the strip's height is kept, so the thread does not shift. */
  if (unread) return null;
  if (following === null) return <div className="kb-glass kb-thread-glass" aria-hidden="true" />;
  const toggle = async () => {
    /* Busy is not disabled: a disabled button drops the keyboard's focus. */
    if (busy) return;
    setBusy(true);
    setRefused(null);
    try {
      const a = await api.follow(thread, !following);
      if (a.ok) setFollowing(a.value); else setRefused(a.error);
    } catch { setRefused('That did not go through. Try again.'); }
    setBusy(false);
  };
  return (
    <div className="kb-glass kb-thread-glass" role="group" aria-label="Thread controls">
      <button type="button" className="kb-glass-cut-button kb-thread-follow" aria-disabled={busy || undefined} onClick={() => void toggle()}>
        {following ? 'Unfollow this thread' : 'Follow this thread'}
      </button>
      {refused && <span className="kb-thread-glass-note" role="alert">{refused}</span>}
    </div>
  );
}
