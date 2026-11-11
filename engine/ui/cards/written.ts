/**
 * What a card that writes has made for a post, as the screens draw it (docs/plans/2026-11-07-you-were-saying-design.md, sections 3, 4 and 7):
 * `resolveWritten`, the one place that says which text a play shows at a version of its post. Pure, so the live post, History and a moment
 * all read it the same way; the rows come from the page's tails (tails.ts).
 */
import type { Id, Tail } from '../data/api.ts';
import type { Written } from './types.ts';

/** How a tail is read: `current` draws the version now (a failure keeps the tail the play had); `version` is a version's own rows alone (History, a moment). */
export type WrittenMode = 'current' | 'version';

/**
 * The versions the rows name, in version order: `post_tails` gives its rows oldest version first, so a version is placed where its first row is.
 * A version no play has a row or a waiting job for is not known here.
 */
export const versionsOf = (rows: readonly Tail[]): readonly Id[] => [...new Set(rows.map((r) => r.version))];

/** The version a post is at now, from its tails: the newest version any play has a row or a waiting job for; null where there is none. */
export const currentVersion = (rows: readonly Tail[]): Id | null => versionsOf(rows).at(-1) ?? null;

/**
 * What each play of a writing card shows at `drawn`, one entry per play that has something to show, from the post's tail rows and its
 * `versions` oldest first.
 *
 * - `current` (the post as it reads now): a generation still waiting for the version is `{ waiting: true }`; the version's own text is
 *   `{ text }`; a failed row, or none, keeps the tail the play had, the text of its latest earlier version ("a failure keeps the tail it
 *   had", design section 3), and is `{ failed: true }` only where the row failed and there is no earlier text.
 * - `version` (History, a moment): the version's own text and nothing else. A failed row, a waiting job and no row all draw none.
 *
 * Read from the rows alone: nothing here depends on who reads or who owns what.
 */
export function resolveWritten(rows: readonly Tail[], versions: readonly Id[], drawn: Id | null, mode: WrittenMode): ReadonlyMap<Id, Written> {
  const out = new Map<Id, Written>();
  if (drawn === null) return out;
  const byPlay = new Map<Id, Map<Id, Tail>>();
  for (const r of rows) {
    const own = byPlay.get(r.play) ?? new Map<Id, Tail>();
    own.set(r.version, r);
    byPlay.set(r.play, own);
  }
  const at = versions.indexOf(drawn);
  const earlier = at < 0 ? [] : versions.slice(0, at).reverse();
  for (const [play, own] of byPlay) {
    const row = own.get(drawn);
    if (row && row.text !== null) { out.set(play, { text: row.text }); continue; }
    if (mode === 'version') continue;
    if (row?.waiting) { out.set(play, { waiting: true }); continue; }
    const kept = earlier.map((v) => own.get(v)).find((r) => r?.text != null);
    if (kept) out.set(play, { text: kept.text! });
    else if (row?.failed) out.set(play, { failed: true });
  }
  return out;
}

/**
 * The version a post was at when it was edited at `editedAt` (or the original, for null), from its History (`KayfaApi.history`, the original
 * first): a play's moment names the version it landed on by its Act, whose `editedAt` is the time of the edit that made it, never by the
 * version's id. Null where History holds no such version. Times are compared as instants, since two reads may write one differently.
 */
export function versionAt(history: readonly { readonly id: Id; readonly kind: string; readonly createdAt: string }[], editedAt: string | null): Id | null {
  if (editedAt === null) return history[0]?.id ?? null;
  const at = Date.parse(editedAt);
  return history.find((v) => v.kind === 'edit' && Date.parse(v.createdAt) === at)?.id ?? null;
}
