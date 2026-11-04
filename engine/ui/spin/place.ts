/**
 * The words and the link of a spun thread's origin place (docs/plans/2026-11-04-origin-place-design.md, section 1). The place
 * comes with the thread's row, worked out in SQL; these two pure functions turn it into the phrase after "spun from" and the
 * address that phrase goes to, so the board's row and the ORIGIN box say the same thing. The engine names no card: a key becomes
 * a name through `cardName`, which the instance's card list answers.
 */
import type { OriginPlace, PlaceOn } from '../data/api.ts';
import { pageOf, threadHref } from '../thread/pages.ts';

const onWords = (on: PlaceOn): string => {
  switch (on.kind) {
    case 'post': return `#${on.seq} in ${on.title}`;
    case 'update': return `the update “${on.title}”`;
    case 'character': return on.name ?? 'a character';
    case 'thread': return `the thread ${on.title}`;
    case 'board': return `the board ${on.name}`;
  }
};

const onHref = (on: PlaceOn, perPage: number): string => {
  switch (on.kind) {
    case 'post': return threadHref(on.thread, pageOf(on.seq, perPage), on.seq);
    case 'update': return `/updates?update=${encodeURIComponent(on.act)}`;
    case 'character': return `/c/${encodeURIComponent(on.id)}`;
    case 'thread': return threadHref(on.id, 1);
    case 'board': return `/b/${encodeURIComponent(on.slug)}`;
  }
};

/** The phrase after "spun from": a place, or a play and where it landed. A face-down set and a key the instance lacks never name a card. */
export function placeWords(place: OriginPlace, cardName: (key: string) => string | undefined): string {
  if (place.kind !== 'play') return onWords(place);
  const card = place.card === null ? 'a face-down card' : cardName(place.card) ?? 'a card';
  return place.on === null ? card : `${card} on ${onWords(place.on)}`;
}

/** Where the phrase goes, or null where there is nowhere (a play whose target cannot be placed). */
export function placeHref(place: OriginPlace, perPage: number): string | null {
  if (place.kind !== 'play') return onHref(place, perPage);
  return place.on === null ? null : onHref(place.on, perPage);
}
