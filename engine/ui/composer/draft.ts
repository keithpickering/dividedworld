/**
 * The draft kept on the device, per account and thread, and the guard that makes a changed HUD
 * character ask before anything is sent ("posting as the wrong mask is the one mistake that
 * unmasks you").
 */
import { useCallback, useEffect, useState } from 'react';
import type { Id } from '../data/api.ts';

export interface Draft {
  readonly text: string;
  /** The character the draft was being written as. */
  readonly as: Id | null;
}

export const draftKey = (account: Id, thread: Id) => `kb-draft:${account}:${thread}`;

/** Every access is guarded: a private window or a full disk keeps nothing, and the reply still goes. */
export function readDraft(key: string): Draft | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as { text?: unknown; as?: unknown };
    return typeof d.text === 'string' && d.text !== '' ? { text: d.text, as: typeof d.as === 'string' ? d.as : null } : null;
  } catch { return null; }
}

export function writeDraft(key: string, draft: Draft): void {
  try {
    if (draft.text === '') globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(draft));
  } catch { /* nothing kept */ }
}

/**
 * Who a draft is being written as. `as` follows the HUD while nothing is written; once something
 * is, a different HUD character is `changed`, and stays so until `confirm` or the HUD swaps back.
 */
export function useWhoPosts(hud: Id | null, dirty: boolean) {
  const [as, setAs] = useState<Id | null>(null);
  useEffect(() => {
    if (hud !== null && (as === null || !dirty)) setAs(hud);
  }, [hud, dirty, as]);
  const confirm = useCallback(() => setAs(hud), [hud]);
  return { as, changed: dirty && as !== null && hud !== null && as !== hud, confirm, adopt: setAs };
}
