/**
 * The thread page's Follow / Unfollow control, a 2003 board button (the board's own `kb-button`, not the glass's): a strip of its own after the thread's last post (above the reply box), outside every post and outside the
 * board's table (the alerts design, sections 4 and 12). A thread one's characters started is followed by default; this follows or
 * unfollows any thread, and it is the way out of a thread followed ("No player is ever stuck"; the Alerts row offers the same).
 *
 * Its state is the server's answer to "does the caller follow this thread", which the thread's page document carries (`following`), never
 * a guess from the thread's posts: the default depends on who started the thread, which is no one else's business and in no public read.
 * It reads nothing of its own: only its button asks the server (`api.follow`) and shows the state it answers; a refusal leaves the button
 * as it was and says why, in plain words. Plain words: the glass never bluffs.

 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';

export function FollowControl({ thread, following: held }: { readonly thread: Id; readonly following: boolean }) {
  const { api } = useKayfa();
  const [following, setFollowing] = useState<boolean>(held);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

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
    <div className="kb-thread-controls" role="group" aria-label="Thread controls">
      <button type="button" className="kb-button kb-thread-follow" data-kb-size="small" aria-disabled={busy || undefined} onClick={() => void toggle()}>
        {following ? 'Unfollow this thread' : 'Follow this thread'}
      </button>
      {refused && <span className="kb-small" role="alert">{refused}</span>}
    </div>
  );
}
