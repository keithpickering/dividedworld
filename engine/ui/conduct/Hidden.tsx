/**
 * The hidden note (the conduct plan, Task 6; the boards in docs/research/2026-11-02-conduct/): one calm strip in place of a hidden version's words, the account notice's plain
 * look and never a mark. The same node stands in a post, in a History row and inside a quote's frame, so a reader meets one sentence wherever the words would have been. It is
 * the glass speaking plainly and out of character ("The fiction may lie; the log never does"): what happened, and where the code is.
 *
 * The author of a version that is hidden until they edit it also sees their own words under it, in a muted panel only they see ("Only you see this"), with Edit; a version an
 * admin hid outright shows its author the note alone, and an edit that waits for an admin after a second hide says so. The words come from `my_hidden_version`, which answers
 * only the post's own player (supabase/migrations/0150_conduct_admin.sql); a reader who does not play the post's mask never asks, so no one else's read depends on it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, MyHiddenVersion } from '../data/api.ts';
import { GlassButton } from '../glass/Button.tsx';
import { Link } from '../router.tsx';
import './report.css';

/** The code of conduct's page, where the note's link goes. */
const CODE = '/conduct';

/** The strip. It is a note (a landmark a reader of a screen can find), and it carries no words of the hidden version. */
export function HiddenNote() {
  return (
    <p className="kb-glass kb-hidden-note" role="note">
      <span>Hidden by an admin: it broke the code of conduct.</span>{' '}
      <Link to={CODE}>Read the code</Link>
    </p>
  );
}

/**
 * What the post's own player may read of it while it is hidden (`my_hidden_version`): undefined while it is being read, null for nothing more than the note. It asks only when
 * `own` (the reader plays the post's mask, which the reader's own screen knows) and the post is hidden.
 */
export function useMyHidden(post: Id, own: boolean, hidden: boolean): MyHiddenVersion | null | undefined {
  const { api } = useKayfa();
  const [read, setRead] = useState<MyHiddenVersion | null | undefined>(undefined);
  const asks = own && hidden;
  useEffect(() => {
    if (!asks) { setRead(undefined); return undefined; }
    let live = true;
    Promise.resolve(api.myHiddenVersion(post)).then((r) => { if (live) setRead(r); }, () => { if (live) setRead(null); });
    return () => { live = false; };
  }, [api, post, asks]);
  return asks ? read : undefined;
}

/**
 * The author's panel under the note: their own words and Edit while the version is hidden until they edit it; the one line about the waiting edit after a second hide. The words are
 * drawn by the caller (`children`, as the board draws a post's words), since the renderer of BBCode draws this note inside a quote and so cannot be imported here.
 */
export function HiddenOwn({ own, onEdit, children }: { readonly own: MyHiddenVersion; readonly onEdit: () => void; readonly children: ReactNode }) {
  if (own.status === 'waiting') {
    return <div className="kb-glass kb-hidden-own"><p>You edited this post. An admin will look at your edit before it shows again.</p></div>;
  }
  return (
    <div className="kb-glass kb-hidden-own">
      <p className="kb-hidden-own-head">Only you see this</p>
      <div className="kb-hidden-own-words">{children}</div>
      <GlassButton kind="secondary" size="s" onClick={onEdit}>Edit</GlassButton>
    </div>
  );
}
