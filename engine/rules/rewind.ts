/**
 * The points a rewind card may name (the Time Machine design, sections 3 and 4.1), computed from the post's versions and its plays. Pure: it reads
 * no clock and imports nothing from the UI or a vendor, and SQL decides again and is the authority.
 */
import { refuse, ok, spanMs, type Verdict } from './cards.ts';
import type { Span } from './types.ts';

/** A version of a post: the post's own Act, or one of its `edit` Acts. `at` is when it was saved, an ISO time. */
export type Version = { readonly id: string; readonly at: string };

/** A card play on the post, as far as the points need it: its Act id and when it was played, an ISO time. */
export type Play = { readonly id: string; readonly at: string };

/** A point offered to the player: the version it names, its time, and whether it is the post as first posted. */
export type RewindPoint = { readonly version: string; readonly at: string; readonly first: boolean };

const time = (iso: string): number => Date.parse(iso);

/**
 * The time a version names. The post itself: its time plus the grace, since an edit saved inside the grace is part of "as first posted". An edit
 * saved after the grace gives its own time; one saved inside it gives none, and is never a point.
 */
export function pointAt(post: Version, version: Version, grace: Span): string | null {
  const first = time(post.at) + spanMs(grace);
  if (Number.isNaN(first)) return null;
  if (version.id === post.id) return new Date(first).toISOString();
  const saved = time(version.at);
  return !Number.isNaN(saved) && saved > first ? version.at : null;
}

/**
 * The points worth offering, oldest first. A point is offered when showing it would change the post: some version was saved after it, or some play
 * played after it still shows (`shown` says so, so this file reads no UI). A point later than `now` is not offered.
 */
export function rewindPoints(post: Version, edits: readonly Version[], plays: readonly Play[], grace: Span, now: Date, shown: (play: Play) => boolean): RewindPoint[] {
  const versions = [post, ...edits];
  const showing = plays.filter(shown);
  const out: RewindPoint[] = [];
  for (const v of [...versions].sort((a, b) => time(a.at) - time(b.at))) {
    const at = pointAt(post, v, grace);
    if (at === null || time(at) > now.getTime()) continue;
    const later = versions.some((o) => o !== v && time(o.at) > time(at)) || showing.some((p) => time(p.at) > time(at));
    if (later) out.push({ version: v.id, at, first: v.id === post.id });
  }
  return out;
}

/** The words a rewind's point is refused in. SQL (rewind_point_problem) says the same three, in this order, after the first (`rewindConfig`'s). */
export const REWIND_PICK = "pick a point from this post's History";
export const REWIND_IN_GRACE = 'that version was saved in the edit grace window, so it is part of the post as first posted';
export const REWIND_SAME = 'this post shows the same at that point as it does now';

/** What a rewind card's configuration is: the version it names (`{ to }`), checked here as a string; SQL checks it is a point of the post. */
export function rewindConfig(value: unknown): Verdict<{ to: string }> {
  const to = typeof value === 'object' && value !== null ? (value as { to?: unknown }).to : undefined;
  return typeof to === 'string' && to !== '' ? ok({ to }) : refuse(REWIND_PICK);
}

/**
 * Why `to` is no point to rewind the post to, in the server's words and order (rewind_point_problem), or null where it is offered: it names no version of this post; it is an edit saved inside the
 * grace (part of the post as first posted); or showing it would change nothing (`rewindPoints` does not offer it).
 */
export function rewindPointProblem(to: unknown, post: Version, edits: readonly Version[], plays: readonly Play[], grace: Span, now: Date, shown: (play: Play) => boolean): string | null {
  const given = rewindConfig({ to });
  if (!given.ok) return given.why;
  const version = [post, ...edits].find((v) => v.id === given.value.to);
  if (version === undefined) return REWIND_PICK;
  if (pointAt(post, version, grace) === null) return REWIND_IN_GRACE;
  return rewindPoints(post, edits, plays, grace, now, shown).some((p) => p.version === version.id) ? null : REWIND_SAME;
}
