/**
 * The draft kept on the device, per account and thread, and the guard that makes a changed HUD
 * character ask before anything is sent ("posting as the wrong mask is the one mistake that
 * unmasks you").
 */
import { useCallback, useEffect, useState } from 'react';
import type { Id, PollDraft } from '../data/api.ts';

export interface Draft {
  readonly text: string;
  /** The character the draft was being written as. */
  readonly as: Id | null;
  /** The poll being written with it, if one is open. */
  readonly poll?: PollDraft;
}

export const draftKey = (account: Id, thread: Id) => `kb-draft:${account}:${thread}`;

/** A kept poll, if it is shaped as a draft is; anything else is dropped. */
function pollOf(v: unknown): PollDraft | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  const lasts = p.lasts as { unit?: unknown; count?: unknown } | undefined;
  return typeof p.question === 'string' && Array.isArray(p.options) && p.options.every((o) => typeof o === 'string') && typeof p.pick === 'number' && typeof p.secret === 'boolean'
    && typeof lasts === 'object' && lasts !== null && typeof lasts.unit === 'string' && typeof lasts.count === 'number'
    ? (p as unknown as PollDraft) : null;
}

/** Every access is guarded: a private window or a full disk keeps nothing, and the reply still goes. */
export function readDraft(key: string): Draft | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as { text?: unknown; as?: unknown; poll?: unknown };
    const poll = pollOf(d.poll);
    if (typeof d.text !== 'string' || (d.text === '' && !poll)) return null;
    return { text: d.text, as: typeof d.as === 'string' ? d.as : null, ...(poll ? { poll } : {}) };
  } catch { return null; }
}

/** Every draft an account kept on this device: it leaves with the account's sign-out. */
export function clearDrafts(account: Id): void {
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    const prefix = `kb-draft:${account}:`;
    for (const key of Object.keys(store)) if (key.startsWith(prefix)) store.removeItem(key);
  } catch { /* nothing kept, nothing to clear */ }
}

export function writeDraft(key: string, draft: Draft): void {
  try {
    if (draft.text === '' && !draft.poll) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(draft));
  } catch { /* nothing kept */ }
}

/**
 * Who a draft is being written as. `as` follows the HUD while nothing is written; once something
 * is, a different HUD character is `changed`, and stays so until `confirm` or the HUD swaps back.
 */
export function useWhoPosts(hud: Id | null, dirty: boolean, kept: Id | null = null) {
  const [as, setAs] = useState<Id | null>(kept ?? hud);
  useEffect(() => {
    if (hud !== null && (as === null || !dirty)) setAs(hud);
  }, [hud, dirty, as]);
  const confirm = useCallback(() => setAs(hud), [hud]);
  return { as, changed: dirty && as !== null && hud !== null && as !== hud, confirm, adopt: setAs };
}
