/**
 * Laugh Track (Pepperoni, uncommon): the caster picks one to five cues, each a phrase in the post and the sound of an audience (a laugh,
 * a cheer or a boo), and a reader who reaches a cued place hears it (docs/plans/2026-11-11-laugh-track-design.md, section 5).
 *
 * Its rules here are its bounds, where it lands and its price; the sounds and the caption are the screens'. Both find a phrase with the
 * engine's one matcher (engine/bbcode/phrase.ts) over the post's visible text, so the places a screen cues are the ones the server priced.
 *
 * - **A cue** is a phrase, bounded as Autocorrect's is (4 to 100 characters, at least 4 letters or digits, one line), and a sound.
 *   Two cues with the same words are one cue too many.
 * - **It lands** only where every cue's phrase is in the post's own words, no two cued places overlap and at most `PLACES.most` places are
 *   cued, on a post with no audience yet: it stacks one deep.
 * - **Its price** is the base price at the machine, plus `perPlace` for each cued place past `freePlaces`, never more than `mostAdded`.
 * - **A persona's cues are repaired, a player's never** (`repairStaff`): what a model overshoots is trimmed and each trim named, so long as one cue remains.
 * - **No saved state:** nothing about it is the author's to save. The seed is the server's, and picks each place's take.
 */
import { economyOf, isLive, landsOn, ok, refuse, type CardRules, type PostTarget } from '../../../engine/rules/cards.ts';
import { occurrences, sameWords } from '../../../engine/bbcode/phrase.ts';
import { PHRASE } from './autocorrect.ts';

export type Sound = 'laugh' | 'cheer' | 'boo';
export interface Cue { readonly phrase: string; readonly sound: Sound }
export type LaughTrackConfig = { readonly cues: readonly Cue[]; readonly seed?: number };
export const CUES = { most: 5 } as const;
export const PLACES = { most: 30 } as const;

const SOUNDS: readonly Sound[] = ['laugh', 'cheer', 'boo'];
const WORDISH = /[\p{L}\p{N}]/gu;
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u;
const characters = (s: string) => [...s].length;

/** A cued place: where a cue's phrase is in the text, with the cue's index. */
export interface Place { readonly from: number; readonly to: number; readonly cue: number }

/** Every occurrence of each cue in the text, in the order of the text, with its cue's index; none is dropped, overlaps included. */
export function placesOf(text: string, cues: readonly Pick<Cue, 'phrase'>[]): Place[] {
  const places = cues.flatMap((c, cue) => occurrences(text, c.phrase).map((o) => ({ from: o.from, to: o.to, cue })));
  return places.sort((a, b) => a.from - b.from || a.to - b.to || a.cue - b.cue);
}

/** Whether any span of `a` overlaps any span of `b`, both sorted by `from`: one pass over the two, each span against the furthest end of the other side so far. */
function crosses(a: readonly { readonly from: number; readonly to: number }[], b: readonly { readonly from: number; readonly to: number }[]): boolean {
  let i = 0;
  let j = 0;
  let aTo = -Infinity;
  let bTo = -Infinity;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i]!.from <= b[j]!.from)) {
      if (bTo > a[i]!.from) return true;
      aTo = Math.max(aTo, a[i++]!.to);
    } else {
      if (aTo > b[j]!.from) return true;
      bTo = Math.max(bTo, b[j++]!.to);
    }
  }
  return false;
}

/** A phrase as a cue holds it (trimmed), or the reason it is out of bounds: the one list `validateConfig` refuses by and `repairCues` drops by. */
function boundedPhrase(raw: string): { readonly ok: true; readonly phrase: string } | { readonly ok: false; readonly why: string } {
  const phrase = raw.trim();
  if (characters(phrase) > PHRASE.most) return { ok: false, why: `the phrase is at most ${PHRASE.most} characters` };
  if ((phrase.match(WORDISH) ?? []).length < PHRASE.least) return { ok: false, why: `the phrase has at least ${PHRASE.least} letters or digits` };
  if (LINE_BREAK.test(phrase)) return { ok: false, why: 'the phrase is one line' };
  return { ok: true, phrase };
}

const cuesOf = (config: unknown): readonly Cue[] | null => {
  const cues = typeof config === 'object' && config !== null ? (config as { cues?: unknown }).cues : undefined;
  return Array.isArray(cues) && cues.every((c) => typeof c?.phrase === 'string') ? (cues as readonly Cue[]) : null;
};

type RepairTrim = { readonly path: string; readonly predicate: string; readonly before: number; readonly after: number };

/**
 * A persona's cues repaired against the post, in order (design, section 5): `cueShape` drops a cue that is not a phrase and a known sound,
 * `phraseNotInPost` one whose phrase is not in the post, `overlapsEarlierCue` one that repeats an earlier kept cue's words or covers
 * words an earlier kept cue covers, `mostFiveCues` keeps the first five and `mostThirtyPlaces` drops cues from the end while the places
 * pass thirty. Each predicate that drops anything is one trim, with the cue counts before and after. It never invents a cue; with none left
 * (or no list of cues at all) the options are returned unchanged, so the decision refuses in the card's own words.
 */
function repairCues(config: unknown, target: PostTarget): { readonly config: unknown; readonly trims: readonly RepairTrim[] } {
  const raw = typeof config === 'object' && config !== null ? (config as { cues?: unknown }).cues : undefined;
  if (!Array.isArray(raw)) return { config, trims: [] };
  const trims: RepairTrim[] = [];
  let kept: unknown[] = raw;
  const drop = (predicate: string, next: unknown[]) => {
    if (next.length < kept.length) trims.push({ path: 'card.config.laugh-track.cues', predicate, before: kept.length, after: next.length });
    kept = next;
  };
  // A cue is kept as validation reads it: the trimmed phrase, within the phrase's bounds, and a known sound. Nothing below can then meet a phrase the matcher cannot take.
  const shaped: Cue[] = [];
  for (const c of kept) {
    const { phrase: p, sound } = typeof c === 'object' && c !== null ? (c as { phrase?: unknown; sound?: unknown }) : {};
    if (typeof p !== 'string' || !SOUNDS.includes(sound as Sound)) continue;
    const bounded = boundedPhrase(p);
    if (bounded.ok) shaped.push({ phrase: bounded.phrase, sound: sound as Sound });
  }
  drop('cueShape', shaped);
  // `phraseNotInPost` and `overlapsEarlierCue` run in that order on each cue, and stop once five clear cues are kept: the rest are left
  // unexamined for `mostFiveCues` to drop, so the work is bounded by the cap and not by the list (and each trim counts the unexamined as left).
  const clear: Cue[] = [];
  let examined = 0;
  let notInPost = 0;
  for (const c of shaped) {
    if (clear.length >= CUES.most) break;
    examined++;
    const mine = occurrences(target.text, c.phrase);
    if (mine.length === 0) notInPost++;
    else if (!clear.some((o) => sameWords(o.phrase, c.phrase)) && !crosses(mine, placesOf(target.text, clear))) clear.push(c);
  }
  const unexamined = shaped.slice(examined);
  const path = 'card.config.laugh-track.cues';
  const inPost = shaped.length - notInPost;
  if (notInPost > 0) trims.push({ path, predicate: 'phraseNotInPost', before: shaped.length, after: inPost });
  const overlapping = examined - notInPost - clear.length;
  if (overlapping > 0) trims.push({ path, predicate: 'overlapsEarlierCue', before: inPost, after: inPost - overlapping });
  kept = [...clear, ...unexamined];
  drop('mostFiveCues', kept.slice(0, CUES.most));
  let fewer = kept as Cue[];
  while (fewer.length > 1 && placesOf(target.text, fewer).length > PLACES.most) fewer = fewer.slice(0, -1);
  drop('mostThirtyPlaces', fewer);
  return kept.length === 0 ? { config, trims: [] } : { config: { ...(config as object), cues: kept }, trims };
}

export const laughTrack: CardRules<LaughTrackConfig> = {
  key: 'laugh-track',
  name: 'Laugh Track',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  seeded: true,
  setPhrase: (config) => config.cues[0]!.phrase,
  /** What the screens read: where a reader's line is in the viewport (percent from the top), how long it must dwell on a place (ms), how far a cue reaches from the line (rem), the share of a hit a murmur is (percent) and the fade (ms). */
  screenReads: [
    { key: 'laughTrack.line', whole: true, min: 10, max: 90 },
    { key: 'laughTrack.dwellMs', whole: true, min: 0, max: 2000 },
    { key: 'laughTrack.reachRem', whole: true, min: 2, max: 40 },
    { key: 'laughTrack.murmurMost', whole: true, min: 0, max: 100 },
    { key: 'laughTrack.fadeMs', whole: true, min: 0, max: 2000 },
  ],
  reads: [{ key: 'laughTrack.perPlace', whole: true, min: 0 }, { key: 'laughTrack.freePlaces', whole: true, min: 0 }, { key: 'laughTrack.mostAdded', whole: true, min: 1 }],
  playPrice: (settings, target, config) => {
    if (target.reach !== 'post') return 0;
    const room = economyOf(settings, 'laughTrack.mostAdded');
    // A face asks the most a play could add, before anyone has picked a cue (engine/ui/cards/faces.ts).
    const cues = cuesOf(config);
    if (!cues) return Math.max(0, room);
    const places = placesOf(target.text, cues).length;
    return Math.max(0, Math.min(economyOf(settings, 'laughTrack.perPlace') * Math.max(0, places - economyOf(settings, 'laughTrack.freePlaces')), room));
  },
  canApply: (target, effects, config, now) => {
    // One director: a post's audience is a single play, said in the card's own words rather than landsOn's.
    if (target.reach === 'post' && effects.some((e) => e.card === laughTrack.key && (e.reach ?? 'post') === 'post' && isLive(e, now))) return refuse('this post already has an audience');
    const lands = landsOn(laughTrack, target, effects, now);
    const cues = cuesOf(config);
    // The screens ask with whatever the form holds, which before a cue is picked has none.
    if (!lands.ok || !cues || target.reach !== 'post') return lands;
    for (const c of cues) if (!occurrences(target.text, c.phrase).length) return refuse(`“${c.phrase}” is not in this post's own words`);
    const places = placesOf(target.text, cues);
    let to = -Infinity;
    for (const p of places) {
      if (p.from < to) return refuse('two cues cover the same words');
      to = Math.max(to, p.to);
    }
    if (places.length > PLACES.most) return refuse(`these cues cover ${places.length} places in this post; a play covers at most ${PLACES.most}`);
    return lands;
  },
  staffOptions: {
    prompt: "Choose up to five cues: each a phrase copied exactly from the post you are replying to (whole words, on one line, at least 4 letters or digits) and the audience's sound when a reader reaches it: laugh, cheer or boo.",
    schema: {
      type: 'object',
      properties: { cues: { type: 'array', items: { type: 'object', properties: { phrase: { type: 'string' }, sound: { type: 'string', enum: ['laugh', 'cheer', 'boo'] } }, required: ['phrase', 'sound'], additionalProperties: false } } },
      required: ['cues'],
      additionalProperties: false,
    },
  },
  repairStaff: repairCues,
  validateConfig: (config) => {
    const { cues: raw, seed } = typeof config === 'object' && config !== null ? (config as { cues?: unknown; seed?: unknown }) : {};
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > CUES.most) return refuse(`a play holds 1 to ${CUES.most} cues`);
    const cues: Cue[] = [];
    for (const c of raw) {
      const { phrase: p, sound } = typeof c === 'object' && c !== null ? (c as { phrase?: unknown; sound?: unknown }) : {};
      if (typeof p !== 'string' || !SOUNDS.includes(sound as Sound)) return refuse('a cue is a phrase and Laugh, Cheer or Boo');
      const bounded = boundedPhrase(p);
      if (!bounded.ok) return refuse(bounded.why);
      const { phrase } = bounded;
      if (cues.some((o) => sameWords(o.phrase, phrase))) return refuse('two cues have the same phrase');
      cues.push({ phrase, sound: sound as Sound });
    }
    // The seed is the server's, added after the caster's configuration is checked; it is kept when present, and nothing else is.
    return ok({ cues, ...(Number.isSafeInteger(seed) ? { seed: seed as number } : {}) });
  },
};
