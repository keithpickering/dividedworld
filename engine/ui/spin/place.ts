/**
 * The words and the link of a spun thread's origin place (docs/plans/2026-11-04-origin-place-design.md, section 1). The place
 * comes with the thread's row, worked out in SQL; `placeParts` turns it into the phrase after "spun from", in the stretches that are
 * links, so the board's row and the ORIGIN box say the same thing, and `placeWords` and `placeHref` read the whole phrase and its
 * first address from it. The engine names no card: a key becomes
 * a name through `cardName`, which the instance's card list answers.
 */
import type { OriginPlace, PlaceOn, PostPlace } from '../data/api.ts';
import { pageOf, threadHref } from '../thread/pages.ts';

const onWords = (on: PlaceOn): string => {
  switch (on.kind) {
    case 'post': return postWords(on);
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

/** One stretch of the phrase: its words, where it goes (null for plain words), and, for a character's name, that character's id. */
export interface PlacePart { readonly words: string; readonly href: string | null; readonly character?: string }

const postWords = (p: PostPlace): string => `#${p.seq} in ${p.title}`;
const cardWords = (card: string | null, cardName: (key: string) => string | undefined): string => card === null ? 'a face-down card' : cardName(card) ?? 'a card';

/**
 * The phrase after "spun from", in the stretches that are links. A play on a character reads "Glitter Bomb on", the character (its
 * profile), then ", at #31 in ..." (the pressed post) or, with none, ", cast from #12 in ..." (the cast-from post); a server that
 * answers neither leaves the name alone. Every other place is one part. A face-down set and a key the instance lacks never name a
 * card. This is the one place the words are worked out: `placeWords` and `placeHref` read it.
 */
export function placeParts(place: OriginPlace, cardName: (key: string) => string | undefined, perPage: number): readonly PlacePart[] {
  if (place.kind !== 'play') return [{ words: onWords(place), href: onHref(place, perPage) }];
  const card = cardWords(place.card, cardName);
  if (place.on === null) return [{ words: card, href: null }];
  if (place.on.kind !== 'character') return [{ words: `${card} on ${onWords(place.on)}`, href: onHref(place.on, perPage) }];
  const who = place.on;
  const parts: PlacePart[] = [
    { words: `${card} on `, href: null },
    { words: onWords(who), href: onHref(who, perPage), character: who.id },
  ];
  const [lead, post] = place.at !== null ? [', at ', place.at] as const : place.from !== null ? [', cast from ', place.from] as const : [null, null];
  if (lead !== null) parts.push({ words: lead, href: null }, { words: postWords(post), href: onHref(post, perPage) });
  return parts;
}

/** The whole phrase after "spun from", as plain words. */
export function placeWords(place: OriginPlace, cardName: (key: string) => string | undefined): string {
  return placeParts(place, cardName, 1).map(part => part.words).join('');
}

/** Where the phrase goes first (a play on a character: the profile), or null where there is nowhere (a play whose target cannot be placed). */
export function placeHref(place: OriginPlace, perPage: number): string | null {
  return placeParts(place, () => undefined, perPage).find(part => part.href !== null)?.href ?? null;
}
